in float a_instanceId;
in vec4 a_instancePositionScale;
in vec4 a_instanceRands;
in vec4 a_instanceRotation;
in vec3 a_instanceColor;

out vec3 v_viewPosition;
out vec3 v_worldPosition;
out vec2 v_uv;
out vec3 v_normal;
out vec3 v_color;
out float v_fogDepth;

#ifndef saturate
    #define saturate( a ) clamp( a, 0.0, 1.0 )
#endif

vec3 qrotate (vec4 q, vec3 v) {
	return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];

struct DirectionalLightShadow {
	float shadowBias;
	float shadowNormalBias;
	float shadowRadius;
	vec2 shadowMapSize;
};

uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];

vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}

void main () {
	vec4 transformed = vec4(qrotate(a_instanceRotation, position) * a_instancePositionScale.w + a_instancePositionScale.xyz, 1.0);
	vec3 transformedNormal = normalMatrix * qrotate(a_instanceRotation, normal);
	vec4 worldPosition = modelMatrix * transformed;

	vec4 mvPosition = modelViewMatrix * transformed;
	gl_Position = projectionMatrix * mvPosition;

	v_viewPosition = mvPosition.xyz;
	v_worldPosition = worldPosition.xyz;
	v_uv = vec2(uv.x * 1.75, uv.y);
	v_normal = transformedNormal;
	v_fogDepth = - mvPosition.z;
	v_color = a_instanceColor;

	vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
	vec4 shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[0].shadowNormalBias, 0 );
	vDirectionalShadowCoord[0] = directionalShadowMatrix[0] * shadowWorldPosition;
}
