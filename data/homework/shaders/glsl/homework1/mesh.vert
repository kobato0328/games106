#version 450

layout (location = 0) in vec3 inPos;
layout (location = 1) in vec3 inNormal;
layout (location = 2) in vec2 inUV;
layout (location = 3) in vec3 inColor;
layout (location = 4) in vec3 inTangent;

layout (set = 0, binding = 0) uniform UBOScene
{
	mat4 projection;
	mat4 view;
	vec4 lightPos;
	vec4 viewPos;
} uboScene;

layout(push_constant) uniform PushConsts {
	mat4 model;
} primitive;

layout (location = 0) out vec3 outNormal;
layout (location = 1) out vec3 outWorldPos;
layout (location = 2) out vec2 outUV;
layout (location = 3) out vec3 outTangent;

void main() 
{
	outNormal = inNormal;
	outUV = inUV;
	outTangent = inTangent;
	outWorldPos = vec3(primitive.model * vec4(inPos, 1.0));
	outNormal = transpose(inverse(mat3(primitive.model))) * inNormal;
	gl_Position = uboScene.projection * uboScene.view * primitive.model * vec4(inPos.xyz, 1.0);
}