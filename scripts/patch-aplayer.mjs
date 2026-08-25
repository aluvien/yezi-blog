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
];

for (const [unsafe, safe] of replacements) {
  if (source.includes(safe)) continue;
  if (!source.includes(unsafe)) throw new Error("APlayer 版本或目标 sink 已变化，拒绝静默跳过安全补丁");
  source = source.replace(unsafe, safe);
}

fs.writeFileSync(target, source);
console.log("APlayer textContent security patch applied");
