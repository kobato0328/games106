#version 450

layout (set = 1, binding = 0) uniform sampler2D samplerColorMap;
layout (set = 2, binding = 0) uniform sampler2D samplerNormalMap;
//metal in chanel b, roughness in chanel g
layout (set = 3, binding = 0) uniform sampler2D samplerMetalRoughMap;
layout (set = 4, binding = 0) uniform sampler2D samplerEmissiveMap;

layout (set = 0, binding = 0) uniform UBOScene
{
	mat4 projection;
	mat4 view;
	vec4 lightPos;
	vec4 viewPos;
	vec4 bFlagSet;
} uboScene;
layout (set = 0, binding = 1) uniform samplerCube samplerIrradiance;
layout (set = 0, binding = 2) uniform sampler2D samplerBRDFLUT;
layout (set = 0, binding = 3) uniform samplerCube prefilteredMap;

layout(set = 5, binding = 0) uniform UBOMaterial
{
	vec3 emissiveFactor; 
	vec4 baseColorFactor;
} materials;

layout (location = 0) in vec3 inNormal;
layout (location = 1) in vec3 inWorldPos;
layout (location = 2) in vec2 inUV;
layout (location = 3) in vec3 inTangent;

layout (location = 0) out vec4 outFragColor;

const float PI = 3.14159265359;

//-------------------------------------------------------------------------
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
vec3 F_Schlick(float cosTheta, vec3 F0)
{
	return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}
vec3 F_SchlickR(float cosTheta, vec3 F0, float roughness)
{
	return F0 + (max(vec3(1.0 - roughness), F0) - F0) * pow(1.0 - cosTheta, 5.0);
}

vec3 prefilteredReflection(vec3 R, float roughness)
{
	const float MAX_REFLECTION_LOD = 9.0; // todo: param/const
	float lod = roughness * MAX_REFLECTION_LOD;
	float lodf = floor(lod);
	float lodc = ceil(lod);
	vec3 a = textureLod(prefilteredMap, R, lodf).rgb;
	vec3 b = textureLod(prefilteredMap, R, lodc).rgb;
	return mix(a, b, lod - lodf);
}

vec3 specularContribution(vec3 L, vec3 V, vec3 N, vec3 F0, float metallic, float roughness, vec3 albedo)
{
	// Precalculate vectors and dot products	
	vec3 H = normalize (V + L);
	float dotNH = clamp(dot(N, H), 1e-4, 1.0);
	float dotNV = clamp(dot(N, V), 1e-4, 1.0);
	float dotNL = clamp(dot(N, L), 1e-4, 1.0);

	// Light color fixed
	vec3 lightColor = vec3(1.0);

	vec3 color = vec3(0.0);

	if (dotNL > 0.0) {
		// D = Normal distribution (Distribution of the microfacets)
		float D = D_GGX(dotNH, roughness); 
		// G = Geometric shadowing term (Microfacets shadowing)
		float G = G_SchlicksmithGGX(dotNL, dotNV, roughness);
		// F = Fresnel factor (Reflectance depending on angle of incidence)
		vec3 F = F_Schlick(dotNV, F0);		
		vec3 spec = D * F * G / (4.0 * dotNL * dotNV + 0.001);		
		vec3 kD = (vec3(1.0) - F) * (1.0 - metallic);			
		color += (kD * albedo / PI + spec) * dotNL;
	}

	return color;
}

// ----------------------------------------------------------------------------
void main() 
{
	vec3 N = normalize(inNormal);
	vec3 realN = N;
	if(uboScene.bFlagSet.x > 0.0) //Flag to Control Normal mapping
	{
		vec3 T = normalize(inTangent);
		vec3 B = cross(N, T);
		mat3 TBN = mat3(T, B, N);
		realN  = TBN * normalize(texture(samplerNormalMap, inUV).rgb * 2.0 - vec3(1.0));
	}
	vec3 V = normalize(uboScene.viewPos.xyz - inWorldPos);
	vec2 roughMetalic = texture(samplerMetalRoughMap, inUV).gb;
	vec3 albedo = texture(samplerColorMap, inUV).rgb * materials.baseColorFactor.xyz;

	vec3 Lo = vec3(0.0);

	vec3 F0 = vec3(0.04); 
	F0 = mix(F0, albedo, roughMetalic.y);

	//for(int i = 0; i < lightLength; ++i)
	{
		vec3 L = normalize(uboScene.lightPos.xyz - inWorldPos);
		Lo += specularContribution(L, V, N, F0, roughMetalic.y, roughMetalic.x, albedo);
	}

	vec3 R = reflect(-V, realN);
	vec2 brdf = texture(samplerBRDFLUT, vec2(max(dot(N, V), 0.0), roughMetalic.x)).rg;
	vec3 reflection = prefilteredReflection(R, roughMetalic.x).rgb;	
	vec3 irradiance = texture(samplerIrradiance, N).rgb;

	// Diffuse based on irradiance
	vec3 diffuse = irradiance * albedo;	
	vec3 F = F_SchlickR(max(dot(N, V), 0.0), F0, roughMetalic.x);

	// Specular reflectance
	vec3 specular = reflection * (F * brdf.x + brdf.y);

	// Ambient part
	vec3 kD = 1.0 - F;
	kD *= 1.0 - roughMetalic.y;
	vec3 indirectRadiance = vec3(0.0);
	if(uboScene.bFlagSet.y > 0.0)
	{
		indirectRadiance = (kD * diffuse + specular);
	}

	//Emissive color
	vec3 emissive = texture(samplerEmissiveMap, inUV).rgb;
	// Combine with ambient
	vec3 color = indirectRadiance + Lo + emissive * materials.emissiveFactor;

	outFragColor = vec4(color, 1.0);
}