/** 好友服务接口 —— 端口 8001。 */
import { get, post } from './client'

/** 好友关系状态。用 const 对象代替 enum —— tsconfig 开了 erasableSyntaxOnly。 */
export const FriendStatus = {
  Unspecified: 0,
  Pending: 1,
  Accepted: 2,
  Rejected: 3,
} as const

export type FriendStatus = (typeof FriendStatus)[keyof typeof FriendStatus]

/** 单条好友关系。friend_id 是「对方」的 uid。 */
export interface FriendInfo {
  id: number
  friend_id: string
  nickname: string
  avatar: string
  created_at: number
  created_at_friend: number
  message: string
}

/**
 * 发起好友申请。幂等：重复申请会合并。
 *
 * targetId 是对方 uid，message 是验证消息（可空）。
 */
export function applyFriend(targetId: string, message?: string) {
  return post<{ request_id: number; status: FriendStatus }>('friend', '/apply', {
    target_id: targetId,
    message: message ?? '',
  })
}

/** 同意好友申请。requestId 是申请记录的 id。 */
export function acceptFriend(requestId: number) {
  return post<{ friend: FriendInfo }>('friend', '/accept', { request_id: requestId })
}

/** 拒绝好友申请。requestId 是申请记录的 id。 */
export function rejectFriend(requestId: number) {
  return post('friend', '/reject', { request_id: requestId })
}

/** 删除好友。friendId 是对方 uid，不是关系记录 id。 */
export function removeFriend(friendId: string) {
  return post('friend', '/remove', { friend_id: friendId })
}

/**
 * 列好友。
 *
 * cursor 是上一页返回的 next_cursor（首页传空），pageSize 是每页条数。
 */
export function listFriends(cursor?: number, pageSize = 50) {
  return get<{ friends: FriendInfo[]; next_cursor: number }>('friend', '/list', {
    cursor: cursor || undefined,
    page_size: pageSize,
  })
}

/**
 * 列收到的申请。
 *
 * requests[].friend_id 指向申请发起方；cursor 是上一页的 next_cursor。
 */
export function listPendingRequests(cursor?: number, pageSize = 50) {
  return get<{ requests: FriendInfo[]; next_cursor: number }>('friend', '/pending', {
    cursor: cursor || undefined,
    page_size: pageSize,
  })
}

/** 收到的申请总数。 */
export function countPending(): Promise<{ count: number }> {
  return get<{ count: number }>('friend', '/pending/count')
}
