/** 个人资料页 —— 改昵称、头像、改密、登出。 */
import { useState } from 'react'
import { Avatar } from '../components/Avatar'
import { Modal } from '../components/Modal'
import { toast } from '../utils/toast'
import { useAuthStore } from '../stores/auth'
import { getRefreshToken } from '../api/client'
import * as userApi from '../api/user'
import { errorMessage } from '../utils/errors'
import { formatConversationTime } from '../utils/format'

export function ProfilePage() {
  const user = useAuthStore((s) => s.user)
  const updateProfile = useAuthStore((s) => s.updateProfile)
  const logout = useAuthStore((s) => s.logout)

  const [editing, setEditing] = useState(false)
  const [nickname, setNickname] = useState(user?.nickname ?? '')
  const [avatar, setAvatar] = useState(user?.avatar ?? '')
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  const [pwdOpen, setPwdOpen] = useState(false)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  if (!user) return null

  // 选好文件后立刻直传 OSS，拿到地址填进 avatar 字段。
  // 走直传而不是后端中转 —— 图片字节不经过自己的服务器。
  const handleAvatarPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // 重置 input 的值 —— 选同一个文件两次也要能触发 change。
    e.target.value = ''
    if (!file) return

    setUploading(true)
    try {
      const ext = userApi.fileExt(file.name)
      const token = await userApi.getUploadToken(ext)
      const url = await userApi.uploadToOSS(token, file)
      setAvatar(url)
      toast('头像已上传，记得点保存', 'success')
    } catch (err) {
      toast(errorMessage(err, '头像上传失败'), 'error')
    } finally {
      setUploading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      // 只提交改动过的字段 —— 后端对 mask 里的空值直接拒（INVALID_ARGUMENT），
      // 所以「没改头像」时不能把 avatar 放进 mask。
      const nextNickname = nickname.trim()
      const nextAvatar = avatar.trim()
      const nextPhone = phone.trim()
      const nextEmail = email.trim()
      const changed: { nickname?: string; avatar?: string; phone?: string; email?: string } = {}
      if (nextNickname !== (user.nickname ?? '')) changed.nickname = nextNickname
      if (nextAvatar !== (user.avatar ?? '')) changed.avatar = nextAvatar
      // 手机号清空是合法操作 —— 空串 = 删掉这个号。
      if (nextPhone !== (user.phone ?? '')) changed.phone = nextPhone
      // 邮箱同理。
      if (nextEmail !== (user.email ?? '')) changed.email = nextEmail

      if (Object.keys(changed).length === 0) {
        toast('没有改动', 'info')
        setEditing(false)
        return
      }

      await updateProfile(changed)
      toast('资料已更新', 'success')
      setEditing(false)
    } catch (e) {
      toast(errorMessage(e, '保存失败'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toast('两次输入的新密码不一致', 'error')
      return
    }
    if (!oldPassword || !newPassword) {
      toast('请填写完整', 'error')
      return
    }
    try {
      await userApi.changePassword(oldPassword, newPassword, getRefreshToken() ?? '')
      toast('密码已修改，请重新登录', 'success')
      setPwdOpen(false)
      await logout()
    } catch (e) {
      toast(errorMessage(e, '改密失败'), 'error')
    }
  }

  return (
    <div className="profile-page">
      <header className="page-header">
        <h1 className="page-title">我的资料</h1>
      </header>

      <div className="profile-card">
        <div className="profile-header">
          <Avatar src={user.avatar} name={user.nickname || user.username} size={72} />
          <div className="profile-identity">
            <h2 className="profile-nickname">{user.nickname || user.username}</h2>
            <p className="profile-username">@{user.username}</p>
            {user.created_at > 0 && (
              <p className="profile-joined">
                加入于 {formatConversationTime(user.created_at)}
              </p>
            )}
          </div>
        </div>

        {editing ? (
          <div className="profile-edit">
            <label className="field">
              <span className="field-label">昵称</span>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="你的昵称"
              />
            </label>
            <div className="field">
              <span className="field-label">头像</span>
              <div className="avatar-upload">
                <Avatar src={avatar} name={user.nickname || user.username} size={56} />
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleAvatarPick}
                  disabled={uploading}
                />
              </div>
              {uploading && <p className="field-hint">上传中…</p>}
            </div>
            <div className="field">
              <span className="field-label">联系方式</span>
              <div className="field-pair">
                <label className="field-sub">
                  <span className="field-sub-label">手机号</span>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="11 位手机号"
                    maxLength={11}
                    inputMode="numeric"
                  />
                </label>
                <label className="field-sub">
                  <span className="field-sub-label">邮箱</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="alice@example.com"
                  />
                </label>
              </div>
            </div>
            <div className="profile-edit-actions">
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setEditing(false)
                  setNickname(user.nickname ?? '')
                  setAvatar(user.avatar ?? '')
                  setPhone(user.phone ?? '')
                  setEmail(user.email ?? '')
                }}
              >
                取消
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        ) : (
          <div className="profile-actions">
            <button
              className="btn btn-ghost"
              onClick={() => {
                setNickname(user.nickname ?? '')
                setAvatar(user.avatar ?? '')
                setPhone(user.phone ?? '')
                setEmail(user.email ?? '')
                setEditing(true)
              }}
            >
              编辑资料
            </button>
            <button className="btn btn-ghost" onClick={() => setPwdOpen(true)}>
              修改密码
            </button>
          </div>
        )}
      </div>

      {(user.phone || user.email) && (
        <div className="profile-card">
          {user.phone && (
            <div className="profile-row">
              <span className="profile-row-label">手机号</span>
              <span className="profile-row-value">{user.phone}</span>
            </div>
          )}
          {user.email && (
            <div className="profile-row">
              <span className="profile-row-label">邮箱</span>
              <span className="profile-row-value">{user.email}</span>
            </div>
          )}
        </div>
      )}

      <div className="profile-card">
        <button className="btn btn-danger btn-block" onClick={() => logout()}>
          退出登录
        </button>
      </div>

      <Modal
        open={pwdOpen}
        title="修改密码"
        onClose={() => setPwdOpen(false)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setPwdOpen(false)}>
              取消
            </button>
            <button className="btn btn-primary" onClick={handleChangePassword}>
              确认修改
            </button>
          </>
        }
      >
        <form className="modal-form" onSubmit={handleChangePassword}>
          <label className="field">
            <span className="field-label">当前密码</span>
            <input
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <label className="field">
            <span className="field-label">新密码</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className="field">
            <span className="field-label">确认新密码</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
        </form>
      </Modal>
    </div>
  )
}
