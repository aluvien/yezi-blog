// 预加载钩子：注册 resolve-hook 使测试能解析 @/ 别名。
import { register } from "node:module";

register("./resolve-hook.mjs", import.meta.url);
