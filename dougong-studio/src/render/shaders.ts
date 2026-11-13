// WebGL2 GLSL ES 3.00 着色器集合

export const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// ───────── GBuffer:视空间位置(浮点)或视空间深度(RGBA8 回退)、视空间法线、反照率 ─────────
export const GBUFFER_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUv;
uniform mat4 uViewProj;
uniform mat4 uView;
uniform mat4 uModel;
out vec3 vViewPos;
out vec3 vViewNormal;
out vec3 vWorldNormal;
out vec2 vUv;
void main(){
  vec4 w = uModel * vec4(aPos, 1.0);
  vec4 viewPos = uView * w;
  vViewPos = viewPos.xyz;
  vViewNormal = mat3(uView) * mat3(uModel) * aNormal;
  vWorldNormal = mat3(uModel) * aNormal;
  vUv = aUv;
  gl_Position = uViewProj * w;
}`;

export const GBUFFER_FS = `#version 300 es
precision highp float;
in vec3 vViewPos;
in vec3 vViewNormal;
in vec3 vWorldNormal;
in vec2 vUv;
uniform sampler2D uAlbedo;
uniform sampler2D uNormalMap;
uniform vec4 uTint;
uniform float uNormalStrength;
uniform float uFloatGBuffer;
uniform float uFar;
layout(location=0) out vec4 oPos;
layout(location=1) out vec4 oNormal;
layout(location=2) out vec4 oAlbedo;
void main(){
  vec3 tex = texture(uAlbedo, vUv).rgb;
  // 视空间法线 + 程序法线贴图扰动
  vec3 Nv = normalize(vViewNormal);
  vec3 nm = texture(uNormalMap, vUv).xyz * 2.0 - 1.0;
  vec3 refUp = abs(Nv.z) < 0.99 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  vec3 T = normalize(cross(refUp, Nv));
  vec3 B = cross(Nv, T);
  Nv = normalize(Nv + (T * nm.x + B * nm.y) * uNormalStrength);
  if (uFloatGBuffer > 0.5) {
    oPos = vec4(vViewPos, 1.0);
  } else {
    // 回退:存线性视深度(相机朝 -z,取负)/远裁剪面,与场景绝对尺度无关
    float depth = clamp(-vViewPos.z / uFar, 0.0, 1.0);
    oPos = vec4(depth, 0.0, 0.0, 1.0);
  }
  oNormal = vec4(Nv * 0.5 + 0.5, 1.0);
  oAlbedo = vec4(tex * uTint.rgb, uTint.a);
}`;

// ───────── 阴影深度 pass ─────────
export const SHADOW_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uLightVP;
uniform mat4 uModel;
void main(){ gl_Position = uLightVP * uModel * vec4(aPos, 1.0); }
`;
export const SHADOW_FS = `#version 300 es
precision highp float;
void main(){ }
`;

// ───────── SSAO(视空间半球核采样)─────────
export const SSAO_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D gPos;
uniform sampler2D gNormal;
uniform sampler2D uNoise;
uniform vec3 uSamples[32];
uniform mat4 uProj;
uniform mat4 uProjInv;
uniform float uRadius;
uniform float uFloatGBuffer;
uniform float uFar;
uniform vec2 uScreenSize;
out float oOcclusion;

// 由深度纹理值 + 屏幕 uv 重建视空间位置
vec3 reconstructViewPos(float depth01, vec2 uv){
  float z = -depth01 * uFar;
  vec4 ndc = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  vec4 view = uProjInv * ndc;
  view.xyz /= view.w;
  return vec3(view.xy * (z / view.z), z);
}
vec3 readPos(vec2 uv){
  vec4 raw = texture(gPos, uv);
  if(uFloatGBuffer > 0.5) return raw.xyz;
  return reconstructViewPos(raw.x, uv);
}
void main(){
  vec3 P = readPos(vUv);
  vec3 N = normalize(texture(gNormal, vUv).xyz * 2.0 - 1.0);
  vec3 rand = texture(uNoise, vUv * uScreenSize / 4.0).xyz * 2.0 - 1.0;
  vec3 T = normalize(rand - N * dot(rand, N));
  vec3 B = cross(N, T);
  mat3 TBN = mat3(T, B, N);
  float occ = 0.0;
  for(int i=0;i<32;i++){
    vec3 sp = TBN * uSamples[i];
    sp = dot(sp, N) < 0.0 ? -sp : sp;
    vec3 samplePos = P + sp * uRadius;
    vec4 clip = uProj * vec4(samplePos, 1.0);
    vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
    if(suv.x<0.0||suv.x>1.0||suv.y<0.0||suv.y>1.0) continue;
    vec3 occPos = readPos(suv);
    float rangeCheck = smoothstep(1.0, 0.0, abs(occPos.z - P.z) / uRadius);
    // 提高遮蔽阈值,避免密集构件互相过度压暗
    occ += (occPos.z >= samplePos.z + uRadius * 0.25 ? 1.0 : 0.0) * rangeCheck;
  }
  oOcclusion = 1.0 - (occ / 32.0) * 0.7;
}`;

export const SSAO_BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSSAO;
out float oV;
void main(){
  vec2 texel = 1.0 / vec2(textureSize(uSSAO, 0));
  float s = 0.0;
  for(int x=-2;x<=2;x++) for(int y=-2;y<=2;y++)
    s += texture(uSSAO, vUv + vec2(x,y)*texel).r;
  oV = s / 25.0;
}`;

// ───────── 光照合成(方向光+阴影+环境光+SSAO,视空间 GBuffer)─────────
export const LIGHT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D gPos;
uniform sampler2D gNormal;
uniform sampler2D gAlbedo;
uniform sampler2D uSSAO;
uniform sampler2D uShadow;
uniform mat4 uLightVP;
uniform mat4 uView;
uniform mat4 uProjInv;
uniform vec3 uLightDir;
uniform vec3 uEye;
uniform float uShadowBias;
uniform float uAmbient;
uniform float uFloatGBuffer;
uniform float uFar;
out vec4 oColor;

vec3 reconstructViewPos(float depth01, vec2 uv){
  float z = -depth01 * uFar;
  vec4 ndc = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  vec4 view = uProjInv * ndc;
  view.xyz /= view.w;
  return vec3(view.xy * (z / view.z), z);
}
vec3 readPos(vec2 uv){
  vec4 raw = texture(gPos, uv);
  if(uFloatGBuffer > 0.5) return raw.xyz;
  return reconstructViewPos(raw.x, uv);
}
float shadowFactor(vec3 worldP){
  vec4 lp = uLightVP * vec4(worldP, 1.0);
  vec3 ndc = lp.xyz / lp.w;
  vec2 suv = ndc.xy * 0.5 + 0.5;
  if(suv.x<0.0||suv.x>1.0||suv.y<0.0||suv.y>1.0) return 1.0;
  float depth = ndc.z * 0.5 + 0.5;
  vec2 texel = 1.0 / vec2(textureSize(uShadow, 0));
  float lit = 0.0;
  for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++){
    float sd = texture(uShadow, suv + vec2(x,y)*texel).r;
    lit += depth - uShadowBias > sd ? 0.35 : 1.0;
  }
  return lit / 9.0;
}

void main(){
  vec3 Pv = readPos(vUv);
  vec3 Nv = normalize(texture(gNormal, vUv).xyz * 2.0 - 1.0);
  vec3 albedo = texture(gAlbedo, vUv).rgb;
  float ao = texture(uSSAO, vUv).r;
  // 视空间光向与视线
  vec3 Lv = normalize((uView * vec4(normalize(uLightDir), 0.0)).xyz);
  vec3 Vv = normalize(-Pv);
  float ndl = max(dot(Nv, Lv), 0.0);
  // 世界坐标用于阴影
  vec4 world4 = inverse(uView) * vec4(Pv, 1.0);
  vec3 worldP = world4.xyz / world4.w;
  float sh = shadowFactor(worldP);
  vec3 H = normalize(Lv + Vv);
  float spec = pow(max(dot(Nv, H), 0.0), 48.0) * 0.18;
  vec3 ambient = albedo * uAmbient * ao;
  vec3 diffuse = albedo * ndl * sh * 0.85;
  vec3 color = ambient + diffuse + vec3(spec * sh);
  color = color / (color + vec3(0.85));
  color = pow(color, vec3(1.0 / 2.2));
  oColor = vec4(color, 1.0);
}`;

// ───────── 线框 pass(Barycentric 边缘)─────────
export const LINE_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uViewProj;
uniform mat4 uModel;
void main(){ gl_Position = uViewProj * uModel * vec4(aPos, 1.0); }
`;
export const LINE_FS = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 oColor;
void main(){ oColor = uColor; }
`;

// ───────── 高亮描边 pass(纯色,稍后在屏幕上做膨胀替代为直接半透明覆盖)─────────
export const HIGHLIGHT_VS = GBUFFER_VS;
export const HIGHLIGHT_FS = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 oColor;
void main(){ oColor = uColor; }
`;
