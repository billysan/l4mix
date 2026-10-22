import { inverseMapping, identityCorners } from './mapping.js';

const vertex = `#version 300 es
layout(location=0) in vec2 position;
out vec2 uv;
void main() { uv = position * .5 + .5; gl_Position = vec4(position, 0., 1.); }
`;
const fragment = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 color;
uniform sampler2D image;
uniform vec2 sourceSize;
uniform vec2 outputSize;
uniform float opacity, mirrorX, mirrorY, pixelation;
uniform mat3 colorMatrix;
uniform vec3 colorOffset;
uniform vec2 slide, redShift, greenShift, blueShift;
uniform bool splitChannels;
uniform bool master;
uniform bool mappingEnabled;
uniform mat3 mappingMatrix;
vec4 readImage(vec2 p) {
  if (any(lessThan(p, vec2(0.))) || any(greaterThan(p, vec2(1.)))) return vec4(0.);
  if (!master) {
    float sourceAspect = sourceSize.x / sourceSize.y;
    float outputAspect = outputSize.x / outputSize.y;
    vec2 fit = sourceAspect > outputAspect ? vec2(1., outputAspect / sourceAspect) : vec2(sourceAspect / outputAspect, 1.);
    p = (p - .5) / fit + .5;
    if (any(lessThan(p, vec2(0.))) || any(greaterThan(p, vec2(1.)))) return vec4(0.);
  }
  p = fract(p * vec2(mirrorX, mirrorY));
  if (pixelation > 1.) {
    vec2 grid = max(floor(sourceSize / pixelation), vec2(1.));
    p = (floor(p * grid) + .5) / grid;
  }
  return texture(image, p);
}
void main() {
  vec2 p = uv;
  if (master && mappingEnabled) {
    vec3 projected = mappingMatrix * vec3(uv.x, 1. - uv.y, 1.);
    if (abs(projected.z) < .00001) { color = vec4(0., 0., 0., 1.); return; }
    vec2 original = projected.xy / projected.z;
    if (any(lessThan(original, vec2(0.))) || any(greaterThan(original, vec2(1.)))) { color = vec4(0., 0., 0., 1.); return; }
    p = vec2(original.x, 1. - original.y);
  }
  p -= vec2(slide.x, -slide.y);
  vec4 sampleColor;
  if (splitChannels) {
    vec4 r = readImage(p - vec2(redShift.x, -redShift.y));
    vec4 g = readImage(p - vec2(greenShift.x, -greenShift.y));
    vec4 b = readImage(p - vec2(blueShift.x, -blueShift.y));
    sampleColor = vec4(r.r, g.g, b.b, max(r.a, max(g.a, b.a)));
  } else sampleColor = readImage(p);
  if (sampleColor.a == 0.) { color = master ? vec4(0., 0., 0., 1.) : vec4(0.); return; }
  vec3 c = colorMatrix * sampleColor.rgb + colorOffset;
  float alpha = master ? opacity : opacity * sampleColor.a;
  color = vec4(clamp(c, 0., 1.) * alpha, master ? 1. : alpha);
}
`;
export class Renderer {
  constructor(canvas, { onLost = () => {}, onRestored = () => {} } = {}) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power' });
    if (!this.gl) throw new Error('WebGL2 is unavailable. Enable graphics acceleration or software WebGL in your browser, then reload.');
    this.lost = false;
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; onLost(); });
    canvas.addEventListener('webglcontextrestored', () => {
      try { this.lost = false; this.initialize(); onRestored(); }
      catch (error) { this.lost = true; onLost(error); }
    });
    this.initialize();
  }
  initialize() {
    const gl = this.gl;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(`Video shader failed: ${log}`); }
      return shader;
    };
    const keys = ['image', 'sourceSize', 'outputSize', 'master', 'opacity', 'mirrorX', 'mirrorY', 'pixelation', 'colorMatrix', 'colorOffset', 'mappingEnabled', 'mappingMatrix', 'slide', 'redShift', 'greenShift', 'blueShift'];
    this.variants = [false, true].map(split => {
      const vs = compile(gl.VERTEX_SHADER, vertex);
      // Specialize the zero-shift path so software GL does not pay for three samples.
      const fs = compile(gl.FRAGMENT_SHADER, fragment.replace('uniform bool splitChannels;', `const bool splitChannels = ${split};`));
      const program = gl.createProgram(); gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
      gl.deleteShader(vs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Could not initialize the video effects program.');
      return { program, uniforms: Object.fromEntries(keys.map(key => [key, gl.getUniformLocation(program, key)])) };
    });
    this.program = this.variants[0].program; this.uniforms = this.variants[0].uniforms;
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    this.buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const location = gl.getAttribLocation(this.program, 'position'); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    this.mappingCache = null; this.colorCache = new WeakMap(); this.uploadCanvases = new Map(); this.uploadedTimes = new Map(); this.textures = new Map(); this.target = this.makeTexture(); this.framebuffer = gl.createFramebuffer();
    this.resize(this.canvas.width, this.canvas.height);
  }
  makeTexture() {
    const gl = this.gl, texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }
  resize(width, height) {
    this.canvas.width = width; this.canvas.height = height;
    if (this.lost) return;
    const gl = this.gl;
    for (const id of this.textures.keys()) this.remove(id);
    gl.bindTexture(gl.TEXTURE_2D, this.target);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.target, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Not enough graphics resources for this output size. Try 720p.');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  remove(id) { const texture = this.textures.get(id); if (texture && !this.lost) this.gl.deleteTexture(texture); this.textures.delete(id); this.uploadCanvases.delete(id); this.uploadedTimes.delete(id); }
  draw(texture, size, values, master = false) {
    const gl = this.gl;
    const split = ['redX', 'redY', 'greenX', 'greenY', 'blueX', 'blueY'].some(key => values[key]);
    const variant = this.variants[split ? 1 : 0]; this.program = variant.program; this.uniforms = variant.uniforms;
    gl.useProgram(this.program); gl.uniform1i(this.uniforms.image, 0);
    gl.uniform2f(this.uniforms.outputSize, this.canvas.width, this.canvas.height);
    gl.uniform1i(this.uniforms.mappingEnabled, this.frameMapping ? 1 : 0);
    if (this.frameMapping) gl.uniformMatrix3fv(this.uniforms.mappingMatrix, false, this.frameMapping);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform2f(this.uniforms.sourceSize, ...size); gl.uniform1i(this.uniforms.master, master ? 1 : 0);
    for (const [key, value] of Object.entries(values)) if (this.uniforms[key] != null) gl.uniform1f(this.uniforms[key], value);
    gl.uniform2f(this.uniforms.slide, values.slideX || 0, values.slideY || 0);
    gl.uniform2f(this.uniforms.redShift, values.redX || 0, values.redY || 0);
    gl.uniform2f(this.uniforms.greenShift, values.greenX || 0, values.greenY || 0);
    gl.uniform2f(this.uniforms.blueShift, values.blueX || 0, values.blueY || 0);
    const transform = this.colorTransform(values);
    gl.uniformMatrix3fv(this.uniforms.colorMatrix, false, transform.matrix);
    gl.uniform3fv(this.uniforms.colorOffset, transform.offset);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  colorTransform(v) {
    const signature = [v.red, v.green, v.blue, v.brightness, v.contrast, v.saturation, v.hue, v.inversion].join(',');
    const cached = this.colorCache.get(v);
    if (cached?.signature === signature) return cached;
    const c = Math.cos(v.hue * Math.PI / 180), s = Math.sin(v.hue * Math.PI / 180);
    const hue = [
      [.213 + .787*c - .213*s, .715 - .715*c - .715*s, .072 - .072*c + .928*s],
      [.213 - .213*c + .143*s, .715 + .285*c + .140*s, .072 - .072*c - .283*s],
      [.213 - .213*c - .787*s, .715 - .715*c + .715*s, .072 + .928*c + .072*s],
    ];
    const luminance = [.2126, .7152, .0722], gain = [v.red, v.green, v.blue];
    const sat = luminance.map((_, i) => luminance.map((l, j) => ((i === j ? v.saturation : 0) + (1 - v.saturation) * l) * v.contrast * gain[j]));
    const matrix = new Float32Array(9), offset = new Float32Array(3), inv = 1 - 2 * v.inversion;
    const bias = (v.brightness - .5) * v.contrast + .5;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) matrix[j * 3 + i] = hue[i].reduce((sum, h, k) => sum + h * sat[k][j], 0) * inv;
      offset[i] = hue[i].reduce((sum, h) => sum + h * bias, 0) * inv + v.inversion;
    }
    const result = { signature, matrix, offset }; this.colorCache.set(v, result); return result;
  }
  isNeutral(v) {
    return v.opacity === 1 && v.inversion === 0 && v.brightness === 0 && v.contrast === 1 && v.saturation === 1 && v.red === 1 && v.green === 1 && v.blue === 1 && v.mirrorX === 1 && v.mirrorY === 1 && v.hue === 0 && v.pixelation === 1 && ['slideX', 'slideY', 'redX', 'redY', 'greenX', 'greenY', 'blueX', 'blueY'].every(key => !v[key]);
  }
  render(sources, master, mapping = null) {
    if (this.lost) return false;
    const gl = this.gl, { width, height } = this.canvas;
    gl.useProgram(this.program); gl.bindVertexArray(this.vao); gl.activeTexture(gl.TEXTURE0); gl.uniform1i(this.uniforms.image, 0);
    gl.viewport(0, 0, width, height); gl.uniform2f(this.uniforms.outputSize, width, height);
    let transform = null;
    if (mapping?.points && !identityCorners(mapping.points)) {
      const signature = mapping.points.flat().join(',');
      if (this.mappingCache?.signature !== signature) this.mappingCache = { signature, matrix: inverseMapping(mapping.points) };
      transform = this.mappingCache.matrix;
    }
    this.frameMapping = transform;
    const direct = this.isNeutral(master) && !transform;
    gl.bindFramebuffer(gl.FRAMEBUFFER, direct ? null : this.framebuffer); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    // Screen blend: C = source * opacity + destination * (1 - source * opacity).
    // Keep the framebuffer opaque; a fully visible source never replaces the mix.
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ZERO, gl.ONE);
    for (const source of sources) {
      if (source.error || source.values.opacity === 0 || source.video.readyState < 2 || !source.video.videoWidth) continue;
      let texture = this.textures.get(source.id);
      const fresh = !texture;
      if (!texture) { texture = this.makeTexture(); this.textures.set(source.id, texture); }
      if (source.dirty || fresh || source.video.currentTime !== this.uploadedTimes.get(source.id)) {
        gl.bindTexture(gl.TEXTURE_2D, texture); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        try {
          // Upload no more pixels than the output can display. This matters on software WebGL.
          const scale = Math.min(1, width / source.video.videoWidth, height / source.video.videoHeight);
          let upload = source.video;
          if (scale < 1) {
            let staging = this.uploadCanvases.get(source.id);
            if (!staging) {
              const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(source.video.videoWidth * scale)); c.height = Math.max(1, Math.round(source.video.videoHeight * scale));
              staging = { canvas: c, context: c.getContext('2d') }; this.uploadCanvases.set(source.id, staging);
            }
            staging.context.clearRect(0, 0, staging.canvas.width, staging.canvas.height);
            staging.context.drawImage(source.video, 0, 0, staging.canvas.width, staging.canvas.height); upload = staging.canvas;
          }
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, upload); source.dirty = false; this.uploadedTimes.set(source.id, source.video.currentTime);
        }
        catch (error) { source.onRenderError?.(error); continue; }
      }
      this.draw(texture, [source.video.videoWidth, source.video.videoHeight], source.values);
    }
    gl.disable(gl.BLEND); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!direct) this.draw(this.target, [width, height], master, true);
    return true;
  }
  dispose() {
    if (this.lost) return;
    const gl = this.gl;
    for (const id of this.textures.keys()) this.remove(id);
    gl.deleteTexture(this.target); gl.deleteFramebuffer(this.framebuffer); gl.deleteBuffer(this.buffer); gl.deleteVertexArray(this.vao); this.variants.forEach(({ program }) => gl.deleteProgram(program));
  }
}
