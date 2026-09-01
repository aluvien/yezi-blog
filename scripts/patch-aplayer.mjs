import fs from "node:fs";
import path from "node:path";

const target = path.resolve("node_modules/aplayer/dist/APlayer.min.js");
if (!fs.existsSync(target)) throw new Error(`APlayer 构建文件不存在：${target}`);

let source = fs.readFileSync(target, "utf8");
const replacements = [
  [
    'this.player.template.title.innerHTML=t.name,this.player.template.author.innerHTML=t.artist?" - "+t.artist:""',
    'this.player.template.title.textContent=t.name,this.player.template.author.textContent=t.artist?" - "+t.artist:""',
  ],
  [
    'this.player.template.title.innerHTML="No audio",this.player.template.author.innerHTML=""',
    'this.player.template.title.textContent="No audio",this.player.template.author.textContent=""',
  ],
  [
    '<span class="aplayer-icon aplayer-icon-back">\\n                    \',t+=s.skip,t+=\'\\n                </span>\\n                <span class="aplayer-icon aplayer-icon-play">\\n                    \',t+=s.play,t+=\'\\n                </span>\\n                <span class="aplayer-icon aplayer-icon-forward">\\n                    \',t+=s.skip,t+=\'\\n                </span>\\n                ',
    '<button type="button" class="aplayer-icon aplayer-icon-back">\\n                    \',t+=s.skip,t+=\'\\n                </button>\\n                <button type="button" class="aplayer-icon aplayer-icon-play">\\n                    \',t+=s.play,t+=\'\\n                </button>\\n                <button type="button" class="aplayer-icon aplayer-icon-forward">\\n                    \',t+=s.skip,t+=\'\\n                </button>\\n                ',
  ],
  [
    'this.player.template.skipPlayButton.addEventListener("click",function(){e.player.toggle()})',
    'this.player.template.skipPlayButton.addEventListener("click",function(){e.player.audio.paused?e.player.play():e.player.pause()})',
  ],
  [
    'this.template.button.innerHTML="",setTimeout(function(){e.template.button.innerHTML=o.default.pause},100),this.template.skipPlayButton.innerHTML=o.default.pause',
    'this.template.button.innerHTML=o.default.pause,this.template.skipPlayButton.innerHTML=o.default.pause',
  ],
  [
    'this.template.button.innerHTML="",setTimeout(function(){e.template.button.innerHTML=o.default.play},100),this.template.skipPlayButton.innerHTML=o.default.play',
    'this.template.button.innerHTML=o.default.play,this.template.skipPlayButton.innerHTML=o.default.play',
  ],
];

for (const [unsafe, safe] of replacements) {
  if (!source.includes(unsafe)) {
    if (source.includes(safe)) continue;
    throw new Error("APlayer 版本或目标 sink 已变化，拒绝静默跳过安全补丁");
  }
  // APlayer 的常规与窄屏模板包含重复控件，必须全部替换；只改第一个会让
  // 手机端仍保留首次触摸只聚焦、第二次才点击的 span 伪按钮。
  source = source.replaceAll(unsafe, safe);
}

fs.writeFileSync(target, source);
console.log("APlayer textContent security patch applied");
