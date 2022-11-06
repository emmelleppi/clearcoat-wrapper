uniform sampler2D u_diffuse;
uniform sampler2D u_blurredNormalDirect;
uniform sampler2D u_blurredPositionFresnel;
uniform sampler2D u_worldPositionMap;

uniform sampler2D u_lut;
uniform sampler2D u_envDiffuse;
uniform sampler2D u_envSpecular;
uniform sampler2D u_distortion;

uniform float u_time;

varying vec2 v_uv;

#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#define ENV_LODS 6.0
#define LN2 0.6931472

float luma(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

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

float F_Schlick(float product, float f0, float f90) {
    float fresnel = exp2( ( - 5.55473 * product - 6.98316 ) * product );
    return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
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

float SmithG_GGX(float NdV, float alphaG) {
    float a = alphaG * alphaG;
    float b = NdV*NdV;
    return 1. / (abs(NdV) + max(sqrt(a + b - a*b), EPSILON));
}
float D_GGX(float linearRoughness, float NoH, const vec3 h) {
    float oneMinusNoHSquared = 1.0 - NoH * NoH;
    float a = NoH * linearRoughness;
    float k = linearRoughness / (oneMinusNoHSquared + a * a);
    float d = k * k * (1.0 / PI);
    return d;
}

void main() {
    vec3 lightPosition = vec3(5.0, 2.0, 2.0);
    vec3 cameraPosition = vec3(0.0, 0.0, 2.0);

    vec4 blurredNorm = texture2D(u_blurredNormalDirect, v_uv);
    vec4 blurredPos = texture2D(u_blurredPositionFresnel, v_uv);
        
    vec3 normal = blurredNorm.rgb;
    float direct = blurredNorm.a;

    vec3 worldPosition = blurredPos.rgb;
    float NdV = blurredPos.a;
    
    vec3 originalWorldPosition = texture2D(u_worldPositionMap, v_uv).rgb;
    float voidZones = smoothstep(0.0, 0.1, luma(max(vec3(0.0), worldPosition - originalWorldPosition)));
    
    vec4 color = texture2D(u_diffuse, v_uv);
    vec4 colorBlur = texture2D(u_diffuse, v_uv, 11.0 * voidZones);
    
    vec4 distortion = texture2D(u_distortion, v_uv + vec2(0.01 * u_time, cos(0.03211 * u_time)) + 0.5 * (normal.xy - 0.5));
    distortion = texture2D(u_distortion, 3.0 * v_uv + 0.9 * (distortion.b - 0.5) * vec2(sin(0.1245 * u_time), cos(0.3211 * u_time)) + 0.5 * (normal.xy - 0.5));
    distortion = smoothstep(0.5, 1.0, distortion);
    
    float mask = step(0.22, clamp(NdV + color.a, 0.0, 1.0));
    NdV *= mask;
    
    float fresnel = pow(1.0 - NdV, 4.0);

    normal.xy += 0.025 * (distortion.gr - 0.5);

    vec3 N = mask * normal;
    vec3 L = mask * normalize(lightPosition - worldPosition);
    vec3 V = mask * normalize(cameraPosition - worldPosition);
    vec3 H = normalize(L + V);

    float LdH = saturate(dot(L, H));
    float NdH = saturate(dot(N, H));
    float NdL = saturate(dot(N, L));

    vec3 reflection = normalize(reflect(-V, N));

    vec3 diffuseIBL;
    vec3 specularIBL;
    getIBLContribution(diffuseIBL, specularIBL, NdV, 0.1, N, reflection, vec3(0.0), vec3(1.0));

    // clearcoat thingy
    float Fc = F_Schlick(LdH, 0.04, 1.0);
    float Dc = D_GGX(1.0, NdH, H);
    float Vc = SmithG_GGX(NdL, 0.0) * SmithG_GGX(NdV, 0.0);
    float Frc = Dc * Vc * Fc;

    vec3 final = saturate(0.15 + 3.0 * fresnel) * (diffuseIBL + specularIBL);
    final = colorBlur.rgb - F_Schlick(NdV, 0.04, 1.0) + final;
    final += Frc;
    final += 3.0 * smoothstep(0.0, 1.0, fresnel * fresnel);
    final *= mask;

    float alpha = clamp(color.a + 0.01, 0.0, 1.0) * mask;

    gl_FragColor = vec4(final, alpha);
}