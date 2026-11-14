/** 用户资料弹窗 —— 点群成员头像看对方资料。 */
import { useEffect, useState } from 'react'
import { Avatar } from './Avatar'
import { Modal } from './Modal'
import * as conversationApi from '../api/conversation'
import type { MemberProfile } from '../api/conversation'
import { errorMessage } from '../utils/errors'
import { formatFullDateTime } from '../utils/format'

interface UserProfileModalProps {
  /** 要查的会话 ID —— 用来做成员身份校验。 */
  conversationId: number
  /** 要查的用户 uid。 */
  userId: string
  /** 是否展开。 */
  open: boolean
  /** 关闭弹窗。 */
  onClose: () => void
}

export function UserProfileModal({
  conversationId,
  userId,
  open,
  onClose,
}: UserProfileModalProps) {
  const [profile, setProfile] = useState<MemberProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 打开时拉一次资料。
  //
  // 关掉再打开换一个人时要先清空 —— 否则弹窗里显示的是上一个人的资料，
  // 等新请求返回才替换，中间那一瞬是错的数据。
  useEffect(() => {
    if (!open || !userId) return
    setProfile(null)
    setError('')
    setLoading(true)
    conversationApi
      .getMemberProfile(conversationId, userId)
      .then(setProfile)
      .catch((e) => {
        setProfile(null)
        setError(errorMessage(e, '加载资料失败'))
      })
      .finally(() => setLoading(false))
  }, [open, conversationId, userId])

  // 昵称留空时回退用户名 —— 注册时昵称是可选的，
// 不回退的话成员列表里显示的是「未知用户」。
const name = profile ? profile.nickname.trim() || profile.username : ''

  return (
    <Modal open={open} title="个人资料" narrow onClose={onClose}>
      <div className="user-profile">
        {loading && <p className="user-profile-hint">加载中…</p>}

        {!loading && error && <p className="user-profile-hint is-error">{error}</p>}

        {!loading && !error && profile && (
          <>
            <div className="user-profile-header">
              <Avatar src={profile.avatar} name={name} size={64} />
              <div className="user-profile-identity">
                <h3 className="user-profile-nickname">{name || '未知用户'}</h3>
                <p className="user-profile-username">@{profile.username}</p>
              </div>
            </div>

            <dl className="user-profile-fields">
              <div className="user-profile-field">
                <dt>加入时间</dt>
                <dd>
                  {profile.created_at > 0
                    ? formatFullDateTime(profile.created_at)
                    : '未知'}
                </dd>
              </div>
            </dl>

            {/* uid 只有本人能看懂，但复制出来能帮用户区分同名账号。 */}
            <div className="user-profile-field">
              <dt>用户 ID</dt>
              <dd className="user-profile-uid">{profile.id}</dd>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
