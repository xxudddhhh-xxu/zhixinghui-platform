import { SetMetadata } from '@nestjs/common';

/** 资源动作等级: read < write < manage */
export type PermAction = 'read' | 'write' | 'manage';

export const PERM_META_KEY = 'perm:requirement';

export interface PermRequirement {
  action: PermAction;
  /** 从哪个位置取资源 ID: 'param' 取路由参数, 'body' 取请求体字段 */
  source: 'param' | 'body';
  /** 参数名 / 字段名,默认 'id' */
  field?: string;
  /** 资源类型 */
  type: 'team' | 'document' | 'knowledge';
}

/**
 * 声明接口所需的资源权限,由 PermissionGuard 统一鉴权。
 * @example @RequirePermission({ type: 'document', action: 'write', source: 'param', field: 'id' })
 */
export const RequirePermission = (req: PermRequirement) =>
  SetMetadata(PERM_META_KEY, req);
