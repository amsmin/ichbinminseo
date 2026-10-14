const WIDTH = 700
const HEIGHT = 600
const SEGMENTS = 28
const STAGE_WIDTH = 1536
const STAGE_HEIGHT = 1024

export const PAPER_SHAPE = 'M0 6 C110 26 370 8 677 8 Q690 8 690 22 C682 200 682 400 690 578 Q690 592 677 592 C370 586 110 570 0 598 Z'

// One connected mesh and one canvas per sheet. Adjacent triangles share the
// exact same vertices, so no DOM clip/compositor boundaries can cut the ink.
export class FlexiblePaper {
  private readonly host: HTMLDivElement
  private readonly depthOffset: number
  private readonly canvas: HTMLCanvasElement
  private readonly gl: WebGLRenderingContext
  private readonly projection: Float32Array
  private readonly vertices = new Float32Array((SEGMENTS + 1) * 2 * 5)
  private buffer!: WebGLBuffer
  private frontTexture!: WebGLTexture
  private backTexture!: WebGLTexture
  private front?: HTMLCanvasElement
  private back?: HTMLCanvasElement

  constructor(host: HTMLDivElement, projection: string, depthOffset = 0) {
    this.host = host
    this.depthOffset = depthOffset
    this.projection = new DOMMatrix(projection).toFloat32Array()
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'paper-surface'
    this.canvas.setAttribute('aria-hidden', 'true')
    host.classList.add('flexible-paper')
    host.replaceChildren(this.canvas)
    const gl = this.canvas.getContext('webgl', {
      alpha: true, antialias: true, premultipliedAlpha: true,
      preserveDrawingBuffer: true,
    })
    if (!gl) throw new Error('A continuous paper surface requires WebGL')
    this.gl = gl
    this.initialize()
    this.canvas.addEventListener('webglcontextlost', event => event.preventDefault())
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.initialize()
      if (this.front && this.back) this.setArtwork(this.front, this.back)
      this.resize()
    })
    new ResizeObserver(() => this.resize()).observe(host.closest('.image-stage')!)
    this.resize()
    this.setProgress(0)
  }

  private initialize() {
    const gl = this.gl
    const shader = (type: number, source: string) => {
      const result = gl.createShader(type)!
      gl.shaderSource(result, source)
      gl.compileShader(result)
      if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result) ?? 'Paper shader failed')
      return result
    }
    const vertex = shader(gl.VERTEX_SHADER, `
      attribute vec3 position;
      attribute vec2 uv;
      uniform mat4 projection;
      varying vec2 surfaceUV;
      void main() {
        vec4 p = projection * vec4(position, 1.0);
        gl_Position = vec4(p.x / 768.0 - p.w, p.w - p.y / 512.0,
                           -position.z / 2000.0 * p.w, p.w);
        surfaceUV = uv;
      }
    `)
    const fragment = shader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform sampler2D front;
      uniform sampler2D back;
      varying vec2 surfaceUV;
      void main() {
        vec4 color = gl_FrontFacing ? texture2D(front, surfaceUV) : texture2D(back, surfaceUV);
        if (color.a < 0.005) discard;
        gl_FragColor = color;
      }
    `)
    const program = gl.createProgram()!
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Paper program failed')
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    gl.useProgram(program)
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'projection'), false, this.projection)
    gl.uniform1i(gl.getUniformLocation(program, 'front'), 0)
    gl.uniform1i(gl.getUniformLocation(program, 'back'), 1)
    this.buffer = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    gl.bufferData(gl.ARRAY_BUFFER, this.vertices.byteLength, gl.DYNAMIC_DRAW)
    for (const [name, count, offset] of [['position', 3, 0], ['uv', 2, 12]] as const) {
      const attribute = gl.getAttribLocation(program, name)
      gl.enableVertexAttribArray(attribute)
      gl.vertexAttribPointer(attribute, count, gl.FLOAT, false, 20, offset)
    }
    const indices = new Uint16Array(SEGMENTS * 6)
    for (let i = 0; i < SEGMENTS; i++) indices.set([i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 2, i * 2 + 3, i * 2 + 1], i * 6)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)
    this.frontTexture = gl.createTexture()!
    this.backTexture = gl.createTexture()!
    gl.frontFace(gl.CW)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.clearColor(0, 0, 0, 0)
  }

  setArtwork(front: HTMLCanvasElement, back: HTMLCanvasElement) {
    this.front = front
    this.back = back
    const gl = this.gl
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    for (const [slot, texture, artwork] of [[0, this.frontTexture, front], [1, this.backTexture, back]] as const) {
      gl.activeTexture(gl.TEXTURE0 + slot)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, artwork)
    }
    this.draw()
  }

  private resize() {
    const stageWidth = this.host.closest('.image-stage')!.getBoundingClientRect().width
    const scale = Math.max(0.5, Math.min(2, stageWidth / STAGE_WIDTH * window.devicePixelRatio))
    const width = Math.round(STAGE_WIDTH * scale)
    const height = Math.round(STAGE_HEIGHT * scale)
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
    this.gl.viewport(0, 0, width, height)
    this.draw()
  }

  setProgress(progress: number) {
    const p = Math.max(0, Math.min(1, progress))
    const turning = Math.sin(Math.PI * p)
    const lift = 14 + 68 * p
    let x = 0
    // A closing bundle separates only while lifted. At either resting pose
    // every sheet returns to the original page contour and silhouette.
    let z = this.depthOffset * turning
    for (let i = 0; i <= SEGMENTS; i++) {
      const u = i / SEGMENTS
      this.vertices.set([x, 0, z, u, 0, x, HEIGHT, z, u, 1], i * 10)
      if (i === SEGMENTS) break
      const next = (i + 1) / SEGMENTS
      const angle = -Math.PI * p + 0.82 * turning * (u + next) / 2
      x += Math.cos(angle) * WIDTH / SEGMENTS
      z += -Math.sin(angle) * WIDTH / SEGMENTS + lift * (Math.sin(Math.PI * next) - Math.sin(Math.PI * u))
    }
    this.host.dataset.progress = p.toFixed(5)
    this.draw()
  }

  private draw() {
    const gl = this.gl
    if (!this.front || !this.back || gl.isContextLost()) return
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertices)
    gl.drawElements(gl.TRIANGLES, SEGMENTS * 6, gl.UNSIGNED_SHORT, 0)
  }
}
