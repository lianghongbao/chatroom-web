/** 个人资料页 —— 改昵称、头像、改密、登出。 */
import { useRef, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { Modal } from '../components/Modal'
import { toast } from '../utils/toast'
import { useAuthStore } from '../stores/auth'
import { getRefreshToken } from '../api/client'
import * as userApi from '../api/user'
import { errorMessage } from '../utils/errors'
import { formatFullDateTime } from '../utils/format'

/** 正在就地编辑的字段。null = 没有字段在编辑。 */
type EditingField = 'nickname' | 'phone' | 'email' | null

export function ProfilePage() {
  const user = useAuthStore((s) => s.user)
  const updateProfile = useAuthStore((s) => s.updateProfile)
  const logout = useAuthStore((s) => s.logout)

  // 正在编辑的字段 + 它的草稿值。
  //
  // 不用「编辑资料」模式开关 —— 社交软件（微信、Instagram、LinkedIn）都是
  // 点哪改哪：点昵称那行变输入框，点手机号那行变输入框。
  // 模式开关会让用户先想「我进的是编辑态吗」，逐字段编辑不用想。
  const [editing, setEditing] = useState<EditingField>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  const [pwdOpen, setPwdOpen] = useState(false)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // 隐藏的 file input —— 点头像时用 ref 触发它弹系统选择器。
  const fileRef = useRef<HTMLInputElement>(null)

  if (!user) return null

  // 选好文件后立刻直传 OSS，拿到地址直接写回后端。
  // 走直传而不是后端中转 —— 图片字节不经过自己的服务器。
  //
  // 上传即生效，不等「保存」：头像不在编辑表单里，
  // 指望用户先点编辑再点保存不现实。
  const handleAvatarPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // 重置 input 的值 —— 选同一个文件两次也要能触发 change。
    e.target.value = ''
    if (!file) return

    setUploading(true)
    try {
      const ext = userApi.fileExt(file.name)
      const token = await userApi.getUploadToken(ext)
      // 上传前先按后端给的额度拦一道 —— 别浪费一次直传。
      // 上限跟着后端配置走，前端不写死数字。
      const tooBig = userApi.checkFileSize(file.size, token.max_size)
      if (tooBig) {
        toast(tooBig, 'error')
        return
      }
      const url = await userApi.uploadToOSS(token, file)
      await updateProfile({ avatar: url })
      toast('头像已更新', 'success')
    } catch (err) {
      toast(errorMessage(err, '头像上传失败'), 'error')
    } finally {
      setUploading(false)
    }
  }

  /** 开始编辑某个字段 —— 草稿带上当前值。 */
  const startEdit = (field: EditingField, current: string) => {
    setEditing(field)
    setDraft(current)
  }

  /** 放弃编辑。 */
  const cancelEdit = () => {
    setEditing(null)
    setDraft('')
  }

  /**
   * 保存当前正在编辑的字段。
   *
   * 只提交这一个字段 —— 后端对 mask 里的空值直接拒（INVALID_ARGUMENT），
   * 所以没改的字段不能放进 mask。
   */
  const saveField = async () => {
    if (!editing) return
    const value = draft.trim()
    const current =
      editing === 'nickname'
        ? (user.nickname ?? '')
        : editing === 'phone'
          ? (user.phone ?? '')
          : (user.email ?? '')

    if (value === current) {
      cancelEdit()
      return
    }

    setSaving(true)
    try {
      // 昵称不能是空串 —— 后端会拒（INVALID_ARGUMENT），这里先拦一道。
      if (editing === 'nickname' && !value) {
        toast('昵称不能为空', 'error')
        return
      }
      await updateProfile({ [editing]: value } as {
        nickname?: string
        phone?: string
        email?: string
      })
      toast('资料已更新', 'success')
      cancelEdit()
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

  /**
   * 一行资料。显示态点**值本身**就变输入框，编辑态点「完成」保存。
   *
   * 不要求用户精确点到一个铅笔小图标 —— 直接点文字就行。
   * 群名那边也是这么做的（点标题变输入框），两边手感一致。
   */
  const renderField = (
    field: Exclude<EditingField, null>,
    label: string,
    current: string,
    placeholder: string,
    type: 'text' | 'tel' | 'email' = 'text',
    inputProps: Record<string, unknown> = {},
  ) => {
    const isEditing = editing === field
    return (
      <div className={`profile-field ${isEditing ? 'is-editing' : ''}`}>
        <span className="profile-field-label">{label}</span>
        {isEditing ? (
          <>
            <input
              className="profile-field-input"
              type={type}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  saveField()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  cancelEdit()
                }
              }}
              placeholder={placeholder}
              maxLength={type === 'tel' ? 11 : undefined}
              inputMode={type === 'tel' ? 'numeric' : undefined}
              autoFocus
              {...inputProps}
            />
            <div className="profile-field-actions">
              <button className="profile-field-btn" onClick={cancelEdit} disabled={saving}>
                取消
              </button>
              <button
                className="profile-field-btn is-primary"
                onClick={saveField}
                disabled={saving}
              >
                {saving ? '保存中…' : '完成'}
              </button>
            </div>
          </>
        ) : (
          <>
            {/*
              值本身就是个按钮 —— 点文字就进编辑。
              没有值（未设置）时提示用户去填，而不是显示一个空按钮。
            */}
            <button
              className={`profile-field-value ${current ? '' : 'is-empty'}`}
              onClick={() => startEdit(field, current)}
              title={`点击修改${label}`}
            >
              {current || '未设置，点击添加'}
            </button>
            {/*
              铅笔图标 —— 明说「这行能改」。

              只靠 hover 变色是不够的：不动鼠标的人根本看不出来这里能点。
              微信、QQ、LinkedIn 的资料页都摆一个常驻的铅笔。
            */}
            <button
              className="profile-field-edit"
              onClick={() => startEdit(field, current)}
              title={`修改${label}`}
              aria-label={`修改${label}`}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="profile-page">
      <header className="page-header">
        <h1 className="page-title">我的资料</h1>
      </header>

      {/*
        头图区 —— 大头像 + 昵称 + 用户名。

        头像右下角挂一个「相机」角标：明说「点这里能换头像」，
        比让用户自己猜大头像可不可点强。
      */}
      <div className="profile-hero">
        <div className="profile-avatar-wrap">
          <Avatar
            src={user.avatar}
            name={user.nickname || user.username}
            size={88}
            onClick={() => fileRef.current?.click()}
            title={uploading ? '上传中…' : '点击更换头像'}
          />
          <button
            className="profile-avatar-badge"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            title={uploading ? '上传中…' : '更换头像'}
            aria-label="更换头像"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
          </button>
        </div>

        <div className="profile-identity">
          <h2 className="profile-nickname">{user.nickname || user.username}</h2>
          <p className="profile-username">@{user.username}</p>
          {user.created_at > 0 && (
            <p className="profile-joined">
              加入于 {formatFullDateTime(user.created_at)}
            </p>
          )}
        </div>
      </div>

      {/* 隐藏的 file input —— 头像点一下就弹系统选择器。 */}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleAvatarPick}
        disabled={uploading}
        hidden
      />

      {/*
        个人资料区 —— 一行一项，点哪改哪。

        不用「编辑资料」模式开关，也不在下面再重复显示一遍手机号邮箱。
        同一份信息在一个地方出现两次，改完不同步就会露馅。
      */}
      <section className="profile-section">
        <h3 className="profile-section-title">个人资料</h3>
        <div className="profile-fields">
          {renderField('nickname', '昵称', user.nickname ?? '', '你的昵称')}
          {renderField('phone', '手机号', user.phone ?? '', '11 位手机号', 'tel')}
          {renderField('email', '邮箱', user.email ?? '', 'alice@example.com', 'email')}
        </div>
      </section>

      {/*
        设置区 —— 带 › 的导航行。

        破坏性操作（退出登录）单独放最后一块，
        跟常规设置隔开，误触的概率低。
      */}
      <section className="profile-section">
        <h3 className="profile-section-title">设置</h3>
        <div className="profile-settings">
          <button className="profile-setting" onClick={() => setPwdOpen(true)}>
            <span className="profile-setting-icon">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </span>
            <span className="profile-setting-label">修改密码</span>
            <span className="profile-setting-chevron">›</span>
          </button>
        </div>
      </section>

      <section className="profile-section">
        <div className="profile-settings">
          <button className="profile-setting is-danger" onClick={() => logout()}>
            <span className="profile-setting-icon">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="m16 17 5-5-5-5M21 12H9" />
              </svg>
            </span>
            <span className="profile-setting-label">退出登录</span>
          </button>
        </div>
      </section>

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
