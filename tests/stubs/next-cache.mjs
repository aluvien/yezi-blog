// 测试专用：真实 next/cache 在纯 Node 请求上下文外调用 revalidatePath 会抛
// “static generation store missing”。路由集成测试只验证鉴权与业务链路，
// 缓存失效在 Next 运行时内由框架保证，这里统一替换为记录调用的空实现。
export const revalidateCalls = [];

export function revalidatePath(path, type) {
  revalidateCalls.push({ path, type });
}

export function revalidateTag() {}
export function updateTag() {}
export function refresh() {}
export function cacheLife() {}
export function cacheTag() {}
export function unstable_cache(cb) {
  return cb;
}
export function unstable_noStore() {}
