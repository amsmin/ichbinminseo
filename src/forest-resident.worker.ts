import { FaceLandmarker, FilesetResolver, ImageClassifier, ImageSegmenter, InteractiveSegmenter, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { ResidentAnalysis, ResidentWorkerInput, ResidentWorkerOutput } from './forest-resident.types'
import { recognizeResident } from './forest-recognition'

let human: ImageSegmenter
let pose: PoseLandmarker
let face: FaceLandmarker
let object: InteractiveSegmenter
let classifier: ImageClassifier
let ready: Promise<void> | null = null

function send(message: ResidentWorkerOutput) { self.postMessage(message) }

async function initialize() {
  send({ type:'progress', message:'주민 만들기를 준비하고 있어요…' })
  const files = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm', true)
  human = await ImageSegmenter.createFromOptions(files, {
    baseOptions:{modelAssetPath:'/models/selfie_segmenter.tflite', delegate:'CPU'},
    canvas:new OffscreenCanvas(1,1), runningMode:'IMAGE', outputConfidenceMasks:true, outputCategoryMask:false,
  })
  pose = await PoseLandmarker.createFromOptions(files, {
    baseOptions:{modelAssetPath:'/models/pose_landmarker_lite.task', delegate:'CPU'},
    canvas:new OffscreenCanvas(1,1), runningMode:'IMAGE', numPoses:1,
    minPoseDetectionConfidence:.4, minPosePresenceConfidence:.4,
  })
  face = await FaceLandmarker.createFromOptions(files, {
    baseOptions:{modelAssetPath:'/models/face_landmarker.task', delegate:'CPU'},
    canvas:new OffscreenCanvas(1,1), runningMode:'IMAGE', numFaces:1,
  })
  object = await InteractiveSegmenter.createFromOptions(files, {
    baseOptions:{modelAssetPath:'/models/interactive_segmentation.task', delegate:'CPU'},
  })
  classifier = await ImageClassifier.createFromOptions(files, {
    baseOptions:{modelAssetPath:'/models/efficientnet_lite0.tflite',delegate:'CPU'},
    canvas:new OffscreenCanvas(1,1),runningMode:'IMAGE',maxResults:12,
  })
  send({type:'ready'})
}

function maskPerson(photo: ImageBitmap) {
  const canvas = new OffscreenCanvas(photo.width, photo.height)
  const context = canvas.getContext('2d', {willReadFrequently:true})!
  context.drawImage(photo,0,0)
  const pixels = context.getImageData(0,0,photo.width,photo.height)
  let count=0
  human.segment(photo, result=>{
    const mask=result.confidenceMasks?.[0]
    if (!mask) throw new Error('사람의 경계를 찾지 못했어요. 밝은 곳에서 다시 촬영해주세요.')
    const values=mask.getAsFloat32Array()
    for(let y=0;y<photo.height;y++) for(let x=0;x<photo.width;x++) {
      const confidence=values[Math.min(mask.height-1,Math.floor(y/photo.height*mask.height))*mask.width+Math.min(mask.width-1,Math.floor(x/photo.width*mask.width))]
      const i=(y*photo.width+x)*4
      // Only confident person pixels may contribute to the texture; never use the camera background.
      const alpha=confidence>=.7 ? 255 : confidence>.55 ? Math.round((confidence-.55)/.15*255) : 0
      pixels.data[i+3]=alpha
      if(alpha===0) pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=0
      if(alpha>200) count++
    }
  })
  if(count<photo.width*photo.height*.018) throw new Error('사진에서 사람을 찾지 못했어요. 화면 안에 들어와 다시 촬영해주세요.')
  return pixels
}

function referenceMask(reference: ImageBitmap) {
  const size=160
  const sample=new OffscreenCanvas(size,size)
  const context=sample.getContext('2d', {willReadFrequently:true})!
  context.drawImage(reference,0,0,size,size)
  const pixels=context.getImageData(0,0,size,size).data
  let transparent=0,opaque=0
  for(let i=3;i<pixels.length;i+=4) { if(pixels[i]<32) transparent++; if(pixels[i]>200) opaque++ }
  const result=new Float32Array(size*size)
  if(transparent>size*size*.04 && opaque>size*size*.01) {
    for(let i=0;i<result.length;i++) result[i]=pixels[i*4+3]/255
  } else {
    object.setImage(reference)
    let bestScore=-Infinity
    // A single centered subject is preferred. Alternative seeds cover a gap between limbs.
    for(const seed of [{x:.5,y:.42},{x:.5,y:.65},{x:.38,y:.48}]) {
      // tasks-vision 1.0.1 declares BrushMode but does not export it at runtime; 1 is POSITIVE.
      const mask=object.segment([{brushMode:1,point:[seed],isCompleted:true}])
      try {
        const data=mask.getAsFloat32Array()
        const candidate=new Float32Array(size*size)
        let area=0,edge=0
        for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
          const v=data[Math.min(mask.height-1,Math.floor(y/size*mask.height))*mask.width+Math.min(mask.width-1,Math.floor(x/size*mask.width))]
          candidate[y*size+x]=v
          if(v>.5) { area++; if(x<3||y<3||x>=size-3||y>=size-3) edge++ }
        }
        const fraction=area/(size*size)
        const score=fraction>.015&&fraction<.94 ? fraction-edge/(size*12)*2 : -Infinity
        if(score>bestScore) { bestScore=score; result.set(candidate) }
        if(score>.12 && edge<20) break
      } finally { mask.close() }
    }
    if(!Number.isFinite(bestScore)) throw new Error('대상의 윤곽을 찾기 어려워요. 배경과 구분되는 한 개의 캐릭터 이미지를 넣어주세요.')
  }
  // Smooth the boundary once, retain holes and separated limbs.
  const smooth=new Float32Array(result)
  for(let y=1;y<size-1;y++) for(let x=1;x<size-1;x++) {
    let sum=0
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) sum+=result[(y+dy)*size+x+dx]
    smooth[y*size+x]=sum/9
  }
  for(let i=0;i<size;i++) smooth[i]=smooth[(size-1)*size+i]=smooth[i*size]=smooth[i*size+size-1]=0
  return {silhouette:smooth,maskSize:size}
}

self.onmessage=async (event: MessageEvent<ResidentWorkerInput>)=>{
  const data=event.data
  try {
    ready ??= initialize()
    await ready
    if(data.type==='prepare') return
    send({type:'progress',message:'사진에서 사람만 오려내고 얼굴·팔다리 위치를 찾고 있어요…'})
    const person=maskPerson(data.photo)
    const sourcePose=pose.detect(data.photo)
    const sourceFace=face.detect(data.photo)
    const sourceLandmarks=sourcePose.landmarks[0]??[]
    sourcePose.close()
    send({type:'progress',message:'업로드한 모습의 윤곽을 추출하고 있어요…'})
    const mask=referenceMask(data.reference)
    const referencePose=pose.detect(data.reference)
    send({type:'progress',message:'대상의 종류와 비율을 분석해 미니어처의 신체 구조를 구성하고 있어요…'})
    // Classify the selected object on a neutral background, not the surrounding photograph.
    const classifiedImage=new OffscreenCanvas(320,320)
    const classifiedContext=classifiedImage.getContext('2d')!
    let left=mask.maskSize,top=mask.maskSize,right=0,bottom=0
    for(let y=0;y<mask.maskSize;y++)for(let x=0;x<mask.maskSize;x++)if(mask.silhouette[y*mask.maskSize+x]>.5){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y)}
    const cutout=new OffscreenCanvas(data.reference.width,data.reference.height),cutContext=cutout.getContext('2d')!
    cutContext.drawImage(data.reference,0,0)
    const cutPixels=cutContext.getImageData(0,0,cutout.width,cutout.height)
    for(let y=0;y<cutout.height;y++)for(let x=0;x<cutout.width;x++){
      const value=mask.silhouette[Math.min(mask.maskSize-1,Math.floor(y/cutout.height*mask.maskSize))*mask.maskSize+Math.min(mask.maskSize-1,Math.floor(x/cutout.width*mask.maskSize))]
      cutPixels.data[(y*cutout.width+x)*4+3]=Math.round(Math.max(0,Math.min(1,(value-.35)/.3))*255)
    }
    cutContext.putImageData(cutPixels,0,0)
    const sx=left/mask.maskSize*cutout.width,sy=top/mask.maskSize*cutout.height
    const sw=Math.max(1,(right-left+1)/mask.maskSize*cutout.width),sh=Math.max(1,(bottom-top+1)/mask.maskSize*cutout.height)
    const scale=288/Math.max(sw,sh)
    classifiedContext.fillStyle='#eeeeee';classifiedContext.fillRect(0,0,320,320)
    classifiedContext.drawImage(cutout,sx,sy,sw,sh,(320-sw*scale)/2,(320-sh*scale)/2,sw*scale,sh*scale)
    const predictions=classifier.classify(classifiedImage).classifications[0]?.categories??[]
    const recognition=recognizeResident(predictions,referencePose.landmarks[0]??[])
    const result: ResidentAnalysis={
      person, pose:sourceLandmarks, face:sourceFace.faceLandmarks[0]??[], referencePose:referencePose.landmarks[0]??[],
      ...mask,referenceWidth:data.reference.width,referenceHeight:data.reference.height,
      recognition,
    }
    referencePose.close()
    send({type:'result',result})
  } catch(error) {
    send({type:'error',message:error instanceof Error?error.message:'주민을 만들지 못했어요. 다시 시도해주세요.'})
  } finally {
    if(data.type==='create') { data.photo.close(); data.reference.close() }
  }
}
