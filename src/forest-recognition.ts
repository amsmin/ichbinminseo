import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { ResidentKind, ResidentRecognition } from './forest-resident.types'

type Prediction={categoryName:string;score:number}
// Explicit families supported by the procedural sculptor. Uncertain inputs retain their own contour.
const families:[ResidentKind,string,RegExp][]=[
  ['rabbit','토끼',/rabbit|hare|wood rabbit|angora/],
  ['fox','여우',/fox/],
  ['cat','고양잇과',/tabby|tiger cat|persian cat|siamese|egyptian cat|lynx|leopard|jaguar|lion|tiger|cougar|cheetah/],
  ['dog','강아지',/dog|hound|terrier|retriever|spaniel|shepherd|poodle|collie|corgi|pug|boxer|basenji|malamute|husky|samoyed|chow|keeshond|schnauzer|weimaraner|setter|pointer|pinscher|rottweiler|doberman|briard|kuvasz|vizsla|leonberg|newfoundland|schipperke|affenpinscher|pekinese|pomeranian|papillon|malinois|groenendael|lhasa|shih.tzu|chihuahua|saluki|whippet|wolf|coyote|dingo|dhole/],
  ['bear','곰',/bear|panda/],
  ['squirrel','작은 설치류',/squirrel|marmot|hamster|beaver|chipmunk|porcupine|mouse|dormouse|guinea pig/],
  ['pig','돼지',/\bpig\b|hog|boar|warthog/],
  ['cow','소·양',/\box\b|bison|buffalo|\bram\b|sheep|goat|ibex|bighorn/],
  ['horse','말',/horse|zebra|sorrel|donkey|camel/],
  ['deer','사슴',/deer|antelope|gazelle|impala|hartebeest|elk/],
  ['elephant','코끼리',/elephant|tusker/],
  ['frog','개구리',/frog|toad/],
  ['duck','오리',/duck|drake|goose|merganser/],
  ['penguin','펭귄',/penguin/],
  ['bird','새',/bird|finch|sparrow|robin|jay|magpie|chickadee|bulbul|junco|bunting|tanager|goldfinch|brambling|oriole|bee eater|hummingbird|hornbill|woodpecker|toucan|macaw|cockatoo|lorikeet|parrot|cock\b|hen\b|ostrich|quail|partridge|peacock|grouse|ptarmigan|vulture|eagle|kite\b|owl|swan|pelican|flamingo|heron|egret|stork|crane|oystercatcher|sandpiper|redshank|albatross|bustard|coot|gallinule|spoonbill|black swan/],
  ['fish','물고기',/fish|shark|stingray|electric ray|eel|coho|barracouta|sturgeon|garfish|tench|puffer/],
  ['turtle','거북이',/turtle|tortoise|terrapin/],
  ['insect','곤충',/butterfly|moth|beetle|ladybug|dragonfly|damselfly|grasshopper|cricket|cicada|mantis|ant\b|bee\b|fly\b/],
  ['octopus','해양 생물',/octopus|jellyfish|squid/],
  ['vessel','용기',/bottle|vase|pitcher|jug|goblet|cup|mug|teapot|coffeepot|wine|beaker|bowl/],
  ['vehicle','탈것',/car\b|cab\b|truck|bus\b|van\b|jeep|limousine|convertible|tractor|racer|locomotive|train/],
  ['plant','식물',/flower|daisy|sunflower|pot\b|plant|tree|palm|artichoke/],
  ['fruit','열매',/apple|orange|lemon|pineapple|strawberry|banana|pomegranate|fig\b|pear|acorn|mushroom|agaric|bolete|stinkhorn|earthstar/],
]

export function recognizeResident(predictions:Prediction[],pose:NormalizedLandmark[]):ResidentRecognition {
  const scores=new Map<ResidentKind,{label:string;score:number}>()
  for(const prediction of predictions) {
    const family=families.find(([, ,regex])=>regex.test(prediction.categoryName.toLowerCase()))
    if(!family)continue
    const [kind,label]=family,entry=scores.get(kind)??{label,score:0}
    entry.score+=prediction.score;scores.set(kind,entry)
  }
  const best=[...scores.entries()].sort((a,b)=>b[1].score-a[1].score)[0]
  if(best&&best[1].score>=.24) return {kind:best[0],label:best[1].label,confidence:best[1].score,source:'classifier'}
  const joints=[0,11,12,23,24].map(i=>pose[i])
  if(joints.every(p=>p&&(p.visibility??1)>.65&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1)) {
    return {kind:'human',label:'사람형',confidence:Math.min(...joints.map(p=>p.visibility??1)),source:'pose'}
  }
  return {kind:'object',label:'이미지 윤곽',confidence:best?.[1].score??0,source:'silhouette'}
}
