// 与 src/mirror.js 同一条规则的拷贝（让 follow/ 目录能单独托管）。等价性由 test/followGuide.test.js 断言。
// 规则：自拍和叠加层永远走同一个镜像函数，不得只镜像其一（spec §8 标为最高风险的失败模式）。
export function mirrorPoint(point, canvasWidth) {
  return { x: canvasWidth - point.x, y: point.y };
}
