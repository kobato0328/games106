#version 450

#define USED_NORMAL_MAPPING 1
layout (set = 1, binding = 0) uniform sampler2D samplerColorMap;
layout (set = 2, binding = 0) uniform sampler2D samplerNormalMap;
//metal in chanel b, roughness in chanel g
layout (set = 3, binding = 0) uniform sampler2D samplerMetalRoughMap;

layout (set = 0, binding = 0) uniform UBOScene
{
	mat4 projection;
	mat4 view;
	vec4 lightPos;
	vec4 viewPos;
} uboScene;

layout (location = 0) in vec3 inNormal;
layout (location = 1) in vec3 inWorldPos;
layout (location = 2) in vec2 inUV;
layout (location = 3) in vec3 inTangent;

layout (location = 0) out vec4 outFragColor;

const float PI = 3.14159265359;

// Normal Distribution function --------------------------------------
float D_GGX(float dotNH, float roughness)
{
	float alpha = roughness * roughness;
	float alpha2 = alpha * alpha;
	float denom = dotNH * dotNH * (alpha2 - 1.0) + 1.0;
	return (alpha2)/(PI * denom*denom);
}

// Geometric Shadowing function --------------------------------------
float G_SchlicksmithGGX(float dotNL, float dotNV, float roughness)
{
	float r = (roughness + 1.0);
	float k = (r*r) / 8.0;
	float GL = dotNL / (dotNL * (1.0 - k) + k);
	float GV = dotNV / (dotNV * (1.0 - k) + k);
	return GL * GV;
}

// Fresnel function ----------------------------------------------------
vec3 F_Schlick(float cosTheta, float metallic, vec3 albedo)
{
	vec3 F0 = mix(vec3(0.04), albedo, metallic); // * material.specular
	vec3 F = F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
	return F;
}

vec3 BRDF(vec3 L, vec3 V, vec3 N, vec3 albedo, float metallic, float roughness)
{
	// Precalculate vectors and dot products	
	vec3 H = normalize (V + L);
	float dotNV = clamp(dot(N, V), 1e-4, 1.0);
	float dotNL = clamp(dot(N, L), 0.0, 1.0);
	float dotLH = clamp(dot(L, H), 0.0, 1.0);
	float dotNH = clamp(dot(N, H), 0.0, 1.0);

	// Light color fixed
	vec3 lightColor = vec3(1.0);

	vec3 color = vec3(0.0);

	if (dotNL > 0.0)
	{
		float rroughness = max(0.05, roughness);
		// D = Normal distribution (Distribution of the microfacets)
		float D = D_GGX(dotNH, roughness);
		// G = Geometric shadowing term (Microfacets shadowing)
		float G = G_SchlicksmithGGX(dotNL, dotNV, rroughness);
		// F = Fresnel factor (Reflectance depending on angle of incidence)
		vec3 F = F_Schlick(dotNV, metallic, albedo);

		vec3 spec = D * F * G / (4.0 * dotNL * dotNV);

		color += spec * dotNL * lightColor;
	}

	return color;
}

// ----------------------------------------------------------------------------
void main() 
{
	vec3 N = normalize(inNormal);
	vec3 realN = N;
#ifdef USED_NORMAL_MAPPING
	vec3 T = normalize(inTangent);
	vec3 B = cross(N, T);
	mat3 TBN = mat3(T, B, N);
	realN  = TBN * normalize(texture(samplerNormalMap, inUV).rgb * 2.0 - vec3(1.0));
#endif 
	vec3 V = normalize(uboScene.viewPos.xyz - inWorldPos);
	vec2 roughMetalic = texture(samplerMetalRoughMap, inUV).gb;
	vec3 albedo = texture(samplerColorMap, inUV).rgb;

	vec3 Lo = vec3(0.0);
	//for(int i = 0; i < lightLength; ++i)
	{
		vec3 L = normalize(uboScene.lightPos.xyz - inWorldPos);
		Lo += BRDF(L, V, realN, albedo, max(roughMetalic.g, 1e-3f), max(roughMetalic.r, 1e-3f));
	}
	// Combine with ambient
	vec3 color = albedo * 0.02;
	color += Lo;
	outFragColor = vec4(color, 1.0);
}