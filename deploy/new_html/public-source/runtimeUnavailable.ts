export const PUBLIC_LOCAL_CONNECTOR_MESSAGE =
  '公开源码版不包含发行方开发的本地处理连接器。请按公开文档基于上游官方接口自行实现并完成安全审计。';

export function localConnectorUnavailable(): never {
  throw new Error(PUBLIC_LOCAL_CONNECTOR_MESSAGE);
}
