import type { ResidentAnalysis, ResidentWorkerOutput } from './forest-resident.types'

type AdmissionState='idle'|'loading'|'processing'|'error'

export class ForestAdmission {
  readonly dialog:HTMLDialogElement
  private video:HTMLVideoElement
  private reference:HTMLImageElement
  private snapshot:HTMLImageElement
  private file:HTMLInputElement
  private name:HTMLInputElement
  private drop:HTMLElement
  private message:HTMLElement
  private shoot:HTMLButtonElement
  private generate:HTMLButtonElement
  private progress:HTMLElement
  private state:AdmissionState='idle'
  private stream:MediaStream|null=null
  private worker:Worker|null=null
  private image:HTMLCanvasElement|null=null
  private photo:HTMLCanvasElement|null=null
  private cameraPending=false
  private generation=0
  private cameraGeneration=0
  private watchdog=0
  private onComplete:(data:ResidentAnalysis,name:string)=>void

  constructor(parent:HTMLElement,onComplete:(data:ResidentAnalysis,name:string)=>void) {
    this.onComplete=onComplete
    this.dialog=document.createElement('dialog')
    this.dialog.className='forest-dialog'
    this.dialog.setAttribute('aria-labelledby','forest-dialog-title')
    this.dialog.innerHTML=`<div class="forest-form">
      <header class="forest-dialog-head"><div><small>MAKE A NEW NEIGHBOR</small><h2 id="forest-dialog-title">새로운 모습으로, 입주하기.</h2></div><button class="forest-close" type="button" aria-label="입주 취소">×</button></header>
      <div class="forest-inputs">
        <section class="forest-camera-side"><h3><span>01</span> 지금의 나</h3><div class="forest-media forest-camera-media"><p class="forest-camera-placeholder">카메라를 준비하고 있어요…</p><video autoplay muted playsinline></video><img class="forest-photo" alt="촬영한 사진" hidden><div class="forest-camera-guide" aria-hidden="true"></div><span class="forest-camera-badge">LIVE CAMERA</span></div><button class="forest-secondary forest-shoot" type="button" disabled>카메라 준비 중…</button><p class="forest-note">얼굴과 팔다리가 보이도록 서서 촬영하기를 눌러주세요.</p></section>
        <section><h3><span>02</span> 되고 싶은 모습</h3><label class="forest-media forest-upload"><div class="forest-upload-prompt"><b>＋</b><strong>이미지를 추가해주세요</strong><span>여기로 드래그하거나 클릭해서 선택<br>PNG · JPG · WebP · 최대 10MB</span></div><img class="forest-reference" alt="모델링할 대상 이미지" hidden><input type="file" accept="image/png,image/jpeg,image/webp" aria-label="캐릭터 이미지 선택"></label><p class="forest-note">한 개의 대상이 크게 보이는 이미지가 좋아요. 다시 누르면 바꿀 수 있어요.</p></section>
      </div>
      <div class="forest-admission-bottom"><label class="forest-name">주민 이름 <input maxlength="16" placeholder="이름을 입력해주세요 (선택)" autocomplete="nickname"></label><div class="forest-create-hint">사진과 이미지를 준비한 뒤<br><b>주민 생성하기</b>를 눌러주세요.</div></div>
      <p class="forest-message" role="status" aria-live="polite">사진을 촬영하고 되고 싶은 모습의 이미지를 추가해주세요.</p>
      <button class="forest-primary forest-generate" type="button" disabled>주민 생성하기</button>
      <div class="forest-processing" hidden><span class="forest-spinner"></span><small>MAKING YOUR NEIGHBOR</small><h3>새로운 모습을 빚고 있어요.</h3><p class="forest-processing-copy"></p></div>
    </div>`
    parent.append(this.dialog)
    this.video=this.dialog.querySelector('video')!
    this.reference=this.dialog.querySelector('.forest-reference')!
    this.snapshot=this.dialog.querySelector('.forest-photo')!
    this.file=this.dialog.querySelector('input[type="file"]')!
    this.name=this.dialog.querySelector('.forest-name input')!
    this.drop=this.dialog.querySelector('.forest-upload')!
    this.message=this.dialog.querySelector('.forest-message')!
    this.shoot=this.dialog.querySelector('.forest-shoot')!
    this.generate=this.dialog.querySelector('.forest-generate')!
    this.progress=this.dialog.querySelector('.forest-processing')!
    this.dialog.querySelector('.forest-close')!.addEventListener('click',()=>this.close())
    this.dialog.addEventListener('cancel',event=>{event.preventDefault();this.close()})
    this.dialog.addEventListener('close',()=>{if(!this.dialog.open)this.cancelWork()})
    this.file.addEventListener('change',()=>{const file=this.file.files?.[0];if(file)void this.acceptFile(file);this.file.value=''})
    for(const type of ['dragenter','dragover']) this.drop.addEventListener(type,event=>{
      event.preventDefault();if(this.state!=='processing')this.drop.classList.add('is-dragging')
    })
    this.drop.addEventListener('dragleave',()=>this.drop.classList.remove('is-dragging'))
    this.drop.addEventListener('drop',event=>{
      event.preventDefault();this.drop.classList.remove('is-dragging')
      const file=(event as DragEvent).dataTransfer?.files[0]
      if(file&&this.state!=='processing')void this.acceptFile(file)
    })
    this.shoot.addEventListener('click',()=>this.capture())
    this.generate.addEventListener('click',()=>{void this.createResident()})
    this.video.addEventListener('loadeddata',()=>this.updateControls())
    this.video.addEventListener('canplay',()=>this.updateControls())
  }

  open(residentNumber:number) {
    this.cancelWork()
    this.image=null
    this.photo=null
    this.name.value=''
    this.name.placeholder=`주민 ${residentNumber}`
    this.reference.hidden=this.snapshot.hidden=true
    this.reference.removeAttribute('src');this.snapshot.removeAttribute('src')
    this.drop.classList.remove('has-image')
    this.state='idle';this.file.disabled=false;this.progress.hidden=true
    this.message.textContent='촬영하기를 눌러 사진을 찍고, 되고 싶은 모습의 이미지를 추가해주세요.'
    this.dialog.showModal()
    void this.startCamera()
  }

  close() {this.cancelWork();this.dialog.close()}

  private cancelWork() {
    this.generation++
    window.clearTimeout(this.watchdog)
    this.worker?.terminate();this.worker=null
    this.stopCamera()
  }

  private stopCamera() {
    this.cameraGeneration++
    this.stream?.getTracks().forEach(track=>track.stop());this.stream=null
    this.video.pause();this.video.srcObject=null
    this.cameraPending=false
  }

  private async startCamera() {
    this.stopCamera()
    const generation=this.cameraGeneration
    this.cameraPending=true
    this.updateControls()
    try {
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('카메라를 사용할 수 없어요. HTTPS 주소에서 접속해주세요.')
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:960},height:{ideal:720}},audio:false})
      if(generation!==this.cameraGeneration||!this.dialog.open){stream.getTracks().forEach(track=>track.stop());return}
      this.stream=stream;this.video.srcObject=stream
      await this.video.play()
      if(generation!==this.cameraGeneration||!this.dialog.open)return
      this.snapshot.hidden=true
      this.cameraPending=false
      this.updateControls()
    }catch(error){
      if(generation!==this.cameraGeneration||!this.dialog.open)return
      this.stopCamera()
      this.message.textContent=error instanceof Error&&error.message.includes('HTTPS')?error.message:'카메라 접근을 허용한 뒤 카메라 다시 연결을 눌러주세요.'
      this.updateControls()
    }
  }

  private async acceptFile(file:File) {
    if(this.state==='processing')return
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10*1024*1024){
      this.message.textContent='10MB 이하의 PNG, JPG, WebP 이미지를 선택해주세요.';return
    }
    const generation=++this.generation
    this.state='loading'
    this.image=null
    this.reference.hidden=true;this.drop.classList.remove('has-image')
    this.updateControls()
    const url=URL.createObjectURL(file)
    try {
      const image=new Image();image.src=url;await image.decode()
      if(generation!==this.generation||!this.dialog.open)return
      const scale=Math.min(1,640/Math.max(image.naturalWidth,image.naturalHeight))
      const canvas=document.createElement('canvas')
      canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale))
      canvas.getContext('2d')!.drawImage(image,0,0,canvas.width,canvas.height)
      this.image=canvas;this.reference.src=canvas.toDataURL();this.reference.hidden=false;this.drop.classList.add('has-image')
      this.state='idle'
      this.message.textContent=this.photo?'사진과 이미지가 준비됐어요. 주민 생성하기를 눌러주세요.':'이미지가 준비됐어요. 촬영하기를 눌러 사진도 찍어주세요.'
      this.updateControls()
    }catch{if(generation===this.generation)this.fail('이미지를 읽지 못했어요. 다른 이미지를 선택해주세요.')}
    finally{URL.revokeObjectURL(url)}
  }

  private updateControls() {
    const busy=this.state==='processing'
    const frameReady=!!this.stream&&this.video.readyState>=2&&this.video.videoWidth>0&&this.video.videoHeight>0
    this.shoot.disabled=busy||this.cameraPending||(!this.photo&&!!this.stream&&!frameReady)
    this.shoot.textContent=this.photo?'다시 촬영하기':this.cameraPending?'카메라 준비 중…':this.stream?'촬영하기':'카메라 다시 연결'
    this.generate.disabled=busy||this.state==='loading'||!this.photo||!this.image
    this.generate.textContent=busy?'주민 생성 중…':'주민 생성하기'
    this.file.disabled=busy
    this.name.disabled=busy
    this.dialog.querySelector('.forest-camera-badge')!.textContent=this.photo?'PHOTO SAVED':'LIVE CAMERA'
    this.dialog.querySelector<HTMLElement>('.forest-camera-guide')!.hidden=!!this.photo
  }

  private capture() {
    if(!this.dialog.open||this.state==='processing'||this.cameraPending)return
    if(this.photo||!this.stream){
      this.photo=null;this.snapshot.hidden=true;this.snapshot.removeAttribute('src')
      this.message.textContent='카메라가 준비되면 촬영하기를 눌러주세요.'
      void this.startCamera();return
    }
    if(this.video.readyState<2||!this.video.videoWidth||!this.video.videoHeight){this.message.textContent='카메라 화면이 준비될 때까지 잠시 기다려주세요.';return}
    try {
      const photo=document.createElement('canvas')
      const scale=Math.min(1,640/Math.max(this.video.videoWidth,this.video.videoHeight))
      photo.width=Math.round(this.video.videoWidth*scale);photo.height=Math.round(this.video.videoHeight*scale)
      const context=photo.getContext('2d')!
      context.translate(photo.width,0);context.scale(-1,1);context.drawImage(this.video,0,0,photo.width,photo.height)
      const preview=photo.toDataURL('image/jpeg',.9)
      this.photo=photo;this.snapshot.src=preview;this.snapshot.hidden=false
      this.stopCamera()
      this.message.textContent=this.image?'촬영했어요. 주민 생성하기를 눌러주세요.':'촬영했어요. 오른쪽에 되고 싶은 모습의 이미지를 추가해주세요.'
      this.updateControls()
    }catch{this.message.textContent='사진을 저장하지 못했어요. 촬영하기를 다시 눌러주세요.'}
  }

  private ensureWorker() {
    if(this.worker)return
    const worker=new Worker(new URL('./forest-resident.worker.ts',import.meta.url),{type:'module'})
    this.worker=worker
    worker.onmessage=(event:MessageEvent<ResidentWorkerOutput>)=>{
      if(worker!==this.worker||!this.dialog.open)return
      const data=event.data
      if(data.type==='progress'&&this.state==='processing')this.setProgress(data.message)
      else if(data.type==='error')this.fail(data.message)
      else if(data.type==='result') {
        const name=this.name.value.trim()||this.name.placeholder
        this.setProgress('입체에 사람 텍스처를 입히고 있어요…')
        // Let the progress message paint before constructing the mesh.
        const generation=this.generation
        window.setTimeout(()=>{
          if(generation!==this.generation||!this.dialog.open)return
          try{this.onComplete(data.result,name);this.close()}
          catch(error){this.fail(error instanceof Error?error.message:'입체를 만들지 못했어요. 다시 시도해주세요.')}
        },40)
      }
    }
    worker.onerror=()=>{if(worker===this.worker)this.fail('모델을 실행하지 못했어요. 연결 상태를 확인하고 다시 시도해주세요.')}
    worker.postMessage({type:'prepare'})
  }

  private setProgress(message:string) {
    this.message.textContent=message
    this.progress.querySelector('p')!.textContent=message
  }

  private async createResident() {
    if(!this.dialog.open||this.state==='processing'||this.state==='loading'||!this.image||!this.photo)return
    const generation=this.generation
    this.state='processing';this.progress.hidden=false;this.updateControls()
    this.setProgress('저장한 사진과 이미지로 주민을 만들고 있어요…')
    let photoBitmap:ImageBitmap|null=null,referenceBitmap:ImageBitmap|null=null
    try {
      photoBitmap=await createImageBitmap(this.photo);referenceBitmap=await createImageBitmap(this.image)
      if(generation!==this.generation||!this.dialog.open){photoBitmap.close();referenceBitmap.close();return}
      this.ensureWorker()
      this.worker!.postMessage({type:'create',photo:photoBitmap,reference:referenceBitmap},[photoBitmap,referenceBitmap])
      this.watchdog=window.setTimeout(()=>this.fail('모델 처리 시간이 길어지고 있어요. 연결을 확인한 뒤 다시 시도해주세요.'),90000)
    }catch{photoBitmap?.close();referenceBitmap?.close();if(generation===this.generation)this.fail('촬영한 이미지를 처리하지 못했어요. 다시 시도해주세요.')}
  }

  private fail(message:string) {
    this.generation++
    window.clearTimeout(this.watchdog)
    this.worker?.terminate();this.worker=null
    this.state='error';this.progress.hidden=true
    this.message.textContent=message
    this.updateControls()
  }
}
