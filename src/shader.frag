uniform float u_time;
uniform float u_dt;

uniform vec3 u_color;

uniform vec2 u_normalScale;
uniform sampler2D u_normalMap;
uniform vec2 u_repeat;
uniform sampler2D u_sparklesMap;

uniform sampler2D u_lut;
uniform sampler2D u_envDiffuse;
uniform sampler2D u_envSpecular;

in vec3 v_viewPosition;
in vec3 v_worldPosition;
in vec2 v_uv;
in vec3 v_normal;
in vec3 v_color;
in float v_fogDepth;

layout(location = 0) out vec4 g_color;
layout(location = 1) out vec4 g_normalDirect;
layout(location = 2) out vec4 g_positionFresnel;

#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define ENV_LODS 6.0
#define LN2 0.6931472

uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];

struct DirectionalLightShadow {
    float shadowBias;
    float shadowNormalBias;
    float shadowRadius;
    vec2 shadowMapSize;
};
uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];

#include <packing>

float texture2DCompare( sampler2D depths, vec2 uv, float compare ) {
    return step( compare, unpackRGBAToDepth( texture2D( depths, uv ) ) );
}

float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
    float shadow = 1.0;

    shadowCoord.xyz /= shadowCoord.w;
    shadowCoord.z += shadowBias;

    bvec4 inFrustumVec = bvec4 ( shadowCoord.x >= 0.0, shadowCoord.x <= 1.0, shadowCoord.y >= 0.0, shadowCoord.y <= 1.0 );
    bool inFrustum = all( inFrustumVec );

    bvec2 frustumTestVec = bvec2( inFrustum, shadowCoord.z <= 1.0 );

    bool frustumTest = all( frustumTestVec );

    if ( frustumTest ) {
        vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
        float dx = texelSize.x;
        float dy = texelSize.y;

        vec2 uv = shadowCoord.xy;
        vec2 f = fract( uv * shadowMapSize + 0.5 );
        uv -= f * texelSize;

        shadow = (
            texture2DCompare( shadowMap, uv, shadowCoord.z ) +
            texture2DCompare( shadowMap, uv + vec2( dx, 0.0 ), shadowCoord.z ) +
            texture2DCompare( shadowMap, uv + vec2( 0.0, dy ), shadowCoord.z ) +
            texture2DCompare( shadowMap, uv + texelSize, shadowCoord.z ) +
            mix( texture2DCompare( shadowMap, uv + vec2( -dx, 0.0 ), shadowCoord.z ),
                    texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 0.0 ), shadowCoord.z ),
                    f.x ) +
            mix( texture2DCompare( shadowMap, uv + vec2( -dx, dy ), shadowCoord.z ),
                    texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, dy ), shadowCoord.z ),
                    f.x ) +
            mix( texture2DCompare( shadowMap, uv + vec2( 0.0, -dy ), shadowCoord.z ),
                    texture2DCompare( shadowMap, uv + vec2( 0.0, 2.0 * dy ), shadowCoord.z ),
                    f.y ) +
            mix( texture2DCompare( shadowMap, uv + vec2( dx, -dy ), shadowCoord.z ),
                    texture2DCompare( shadowMap, uv + vec2( dx, 2.0 * dy ), shadowCoord.z ),
                    f.y ) +
            mix( mix( texture2DCompare( shadowMap, uv + vec2( -dx, -dy ), shadowCoord.z ),
                        texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, -dy ), shadowCoord.z ),
                        f.x ),
                    mix( texture2DCompare( shadowMap, uv + vec2( -dx, 2.0 * dy ), shadowCoord.z ),
                        texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 2.0 * dy ), shadowCoord.z ),
                        f.x ),
                    f.y )
        ) * ( 1.0 / 9.0 );
    }

    return shadow;
}

float getShadowMask() {
	float shadow = 1.0;
	DirectionalLightShadow directionalLight = directionalLightShadows[0];
    shadow *= getShadow( directionalShadowMap[0], directionalLight.shadowMapSize, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[0] );
	return shadow;
}

vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}
const float MIN_ROUGHNESS = 0.0525;

vec4 SRGBtoLinear(vec4 srgb) {
    vec3 linOut = pow(srgb.xyz, vec3(2.2));
    return vec4(linOut, srgb.w);;
}

vec4 RGBMToLinear(in vec4 value) {
    float maxRange = 6.0;
    return vec4(value.xyz * value.w * maxRange, 1.0);
}

vec2 cartesianToPolar(vec3 n) {
    vec2 uv;
    uv.x = atan(n.z, n.x) * RECIPROCAL_PI2 + 0.5;
    uv.y = asin(n.y) * RECIPROCAL_PI + 0.5;
    return uv;
}

vec3 specularReflection(vec3 specularEnvR0, vec3 specularEnvR90, float VdH) {
    return specularEnvR0 + (specularEnvR90 - specularEnvR0) * pow(clamp(1.0 - VdH, 0.0, 1.0), 5.0);
}

float geometricOcclusion(float NdL, float NdV, float roughness) {
    float r = roughness;
    float attenuationL = 2.0 * NdL / (NdL + sqrt(r * r + (1.0 - r * r) * (NdL * NdL)));
    float attenuationV = 2.0 * NdV / (NdV + sqrt(r * r + (1.0 - r * r) * (NdV * NdV)));
    return attenuationL * attenuationV;
}

float microfacetDistribution(float roughness, float NdH) {
    float roughnessSq = roughness * roughness;
    float f = (NdH * roughnessSq - NdH) * NdH + 1.0;
    return roughnessSq / (PI * f * f);
}

void getIBLContribution(inout vec3 diffuse, inout vec3 specular, float NdV, float roughness, vec3 n, vec3 reflection, vec3 diffuseColor, vec3 specularColor) {
    vec3 brdf = SRGBtoLinear(texture2D(u_lut, vec2(NdV, roughness))).rgb;
    vec3 diffuseLight = RGBMToLinear(texture2D(u_envDiffuse, cartesianToPolar(n))).rgb;
    // Sample 2 levels and mix between to get smoother degradation
    float blend = roughness * ENV_LODS;
    float level0 = floor(blend);
    float level1 = min(ENV_LODS, level0 + 1.0);
    blend -= level0;
    
    // Sample the specular env map atlas depending on the roughness value
    vec2 uvSpec = cartesianToPolar(reflection);
    uvSpec.y /= 2.0;
    vec2 uv0 = uvSpec;
    vec2 uv1 = uvSpec;
    uv0 /= pow(2.0, level0);
    uv0.y += 1.0 - exp(-LN2 * level0);
    uv1 /= pow(2.0, level1);
    uv1.y += 1.0 - exp(-LN2 * level1);
    vec3 specular0 = RGBMToLinear(texture2D(u_envSpecular, uv0)).rgb;
    vec3 specular1 = RGBMToLinear(texture2D(u_envSpecular, uv1)).rgb;
    vec3 specularLight = mix(specular0, specular1, blend);
    diffuse = diffuseLight * diffuseColor;
    
    // Bit of extra reflection for smooth materials
    float reflectivity = pow((1.0 - roughness), 2.0) * 0.05;
    specular = specularLight * (specularColor * brdf.x + brdf.y + reflectivity);
}

vec3 perturbNormal2Arb( vec3 eye_pos, vec3 surf_norm, vec3 mapN, float faceDirection, vec2 scalingFact ) {
    // Workaround for Adreno 3XX dFd*( vec3 ) bug. See #9988
    vec3 q0 = vec3( dFdx( eye_pos.x ), dFdx( eye_pos.y ), dFdx( eye_pos.z ) );
    vec3 q1 = vec3( dFdy( eye_pos.x ), dFdy( eye_pos.y ), dFdy( eye_pos.z ) );
    vec2 st0 = dFdx( v_uv.st );
    vec2 st1 = dFdy( v_uv.st );
    vec3 N = surf_norm; // normalized
    vec3 q1perp = cross( q1, N );
    vec3 q0perp = cross( N, q0 );
    vec3 T = q1perp * st0.x + q0perp * st1.x;
    vec3 B = q1perp * st0.y + q0perp * st1.y;
    float det = max( dot( T, T ), dot( B, B ) );
    float scale = ( det == 0.0 ) ? 0.0 : faceDirection * inversesqrt( det );
    return normalize( T * ( mapN.x * scale * scalingFact.x ) + B * ( mapN.y * scale * scalingFact.y ) + N * mapN.z );
}

void main () {
	vec3 lightPosition = vec3(5.0, 2.0, 2.0);

	float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;

	vec3 normal = normalize( v_normal ) * faceDirection;

	vec3 mapN = texture2D( u_normalMap, v_uv * u_repeat ).xyz * 2.0 - 1.0;
	mapN.xy *= u_normalScale;
    normal = perturbNormal2Arb(v_viewPosition, normal, mapN, faceDirection, u_normalScale);
    normal.xy += 0.2 * texture2D( u_sparklesMap, v_uv * 0.75 ).xy;

	vec3 N = inverseTransformDirection( normal, viewMatrix );
    vec3 L = normalize(lightPosition - v_worldPosition);
    vec3 V = normalize(cameraPosition - v_worldPosition);
    vec3 H = normalize(L + V);

    vec3 reflection = normalize(reflect(-V, N));
    float NdL = clamp(dot(N, L), 0.001, 1.0);
    float NdV = clamp(abs(dot(N, V)), 0.001, 1.0);
    float NdH = clamp(dot(N, H), 0.0, 1.0);
    float LdH = clamp(dot(L, H), 0.0, 1.0);
    float VdH = clamp(dot(V, H), 0.0, 1.0);

    vec3 plainN = inverseTransformDirection( normalize( v_normal ) * faceDirection, viewMatrix );
    float plainNdV = clamp(abs(dot(plainN, V)), 0.001, 1.0);

	vec3 dxy = max( abs( dFdx( plainN ) ), abs( dFdy( plainN ) ) );
	float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
	float roughness = MIN_ROUGHNESS;
	roughness += geometryRoughness;

    vec3 f0 = vec3(0.04);
    vec3 baseColor = saturate(v_color + 0.15);
    
    vec3 diffuseColor = baseColor * (vec3(1.0) - f0);
    vec3 specularColor = f0;
    
    vec3 specularEnvR0 = specularColor;
    vec3 specularEnvR90 = vec3(clamp(max(max(specularColor.r, specularColor.g), specularColor.b) * 25.0, 0.0, 1.0));

    vec3 F = specularReflection(specularEnvR0, specularEnvR90, VdH);
    float G = geometricOcclusion(NdL, NdV, roughness);
    float D = microfacetDistribution(roughness, NdH);

    vec3 diffuseContrib = (1.0 - F) * (diffuseColor / PI);
    vec3 specContrib = F * G * D / (4.0 * NdL * NdV);

    vec3 diffuseIBL;
    vec3 specularIBL;
    getIBLContribution(diffuseIBL, specularIBL, NdV, roughness, N, reflection, diffuseColor, specularColor);

    vec3 final = (0.5 * NdL + smoothstep(-0.2, 1.6, NdL)) * (diffuseContrib + specContrib);
    final += 0.6 * (diffuseIBL + specularIBL);
	final *= mix(0.25, 1.0, getShadowMask());

    g_color = vec4(final, saturate(exp(4.0 - v_fogDepth * v_fogDepth)));
    g_normalDirect = vec4(plainN, F.r * G * D / (4.0 * NdL * NdV) + (1.0 - F.r) / PI);
    g_positionFresnel = vec4(v_worldPosition, plainNdV);
}
