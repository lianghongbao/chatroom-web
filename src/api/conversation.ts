/** 会话服务接口 —— 端口 8002。 */
import { get, post } from './client'

/** 会话类型。用 const 对象代替 enum —— tsconfig 开了 erasableSyntaxOnly。 */
export const ConversationType = {
  Unspecified: 0,
  Single: 1,
  Group: 2,
} as const

export type ConversationType = (typeof ConversationType)[keyof typeof ConversationType]

/**
 * 会话概要。
 *
 * member_nicknames / member_avatars 与 member_ids 按下标对齐，长度恒等于 member_ids；
 * 资料没拉到时该位置是空字符串占位（不是 bug，是后端 fillProfiles 的降级行为）。
 */
export interface ConversationInfo {
  id: number
  type: ConversationType
  name: string
  owner_id: string
  member_count: number
  member_ids: string[]
  member_nicknames: string[]
  member_avatars: string[]
  last_message: string
  last_message_at: number
  updated_at: number
  created_at: number
}

/** 会话成员列表。三个数组按下标对齐。 */
export interface MemberList {
  member_ids: string[]
  member_nicknames: string[]
  member_avatars: string[]
}

/**
 * 创建会话。
 *
 * 单聊幂等：同一对成员返回同一会话，reused 为 true。
 * member_ids 至少 2 个，服务端会并入调用方自己。
 */
export function createConversation(input: {
  type?: ConversationType
  member_ids: string[]
  name?: string
}) {
  return post<{ conversation: ConversationInfo; reused: boolean }>(
    'conversation',
    '/create',
    {
      type: input.type ?? ConversationType.Unspecified,
      member_ids: input.member_ids,
      name: input.name ?? '',
    },
  )
}

/** 列会话，按最后活动时间倒序。 */
export function listConversations(cursor?: number, pageSize = 50) {
  return get<{ conversations: ConversationInfo[]; next_cursor: number }>(
    'conversation',
    '/list',
    { cursor: cursor || undefined, page_size: pageSize },
  )
}

/** 会话详情。 */
export function getConversation(id: number): Promise<{ conversation: ConversationInfo }> {
  return get<{ conversation: ConversationInfo }>('conversation', '/get', { id })
}

/** 往群聊加人。仅群主可调用。 */
export function addMembers(conversationId: number, memberIds: string[]) {
  return post<{ member_count: number; added_count: number }>(
    'conversation',
    '/members/add',
    { conversation_id: conversationId, member_ids: memberIds },
  )
}

/** 踢人。仅群主可调用。 */
export function removeMember(conversationId: number, memberId: string) {
  return post<{ member_count: number }>('conversation', '/members/remove', {
    conversation_id: conversationId,
    member_id: memberId,
  })
}

/** 退群。群主不能退，需先转让群主。 */
export function leaveConversation(conversationId: number) {
  return post('conversation', '/leave', { conversation_id: conversationId })
}

/** 改群名。仅群主可调用。 */
export function updateConversation(conversationId: number, name: string) {
  return post<{ conversation: ConversationInfo }>('conversation', '/update', {
    conversation_id: conversationId,
    name,
  })
}

/** 转让群主。新群主必须是当前群成员。 */
export function transferOwner(conversationId: number, newOwnerId: string) {
  return post<{ conversation: ConversationInfo }>('conversation', '/owner/transfer', {
    conversation_id: conversationId,
    new_owner_id: newOwnerId,
  })
}

/** 解散群聊。不可恢复。 */
export function dissolveConversation(conversationId: number) {
  return post('conversation', '/dissolve', { conversation_id: conversationId })
}

/** 列会话成员。仅会话成员可见。 */
export function listMembers(conversationId: number): Promise<MemberList> {
  return get<MemberList>('conversation', '/members/list', {
    conversation_id: conversationId,
  })
}
