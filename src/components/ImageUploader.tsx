/** 聊天图片上传 —— 签凭证 → 直传 OSS → 拿回地址。 */
import { useRef, useState } from 'react'
import { getImageUploadToken } from '../api/message'
import type { ImageUploadToken } from '../api/message'
import { checkFileSize, fileExt, uploadToOSS } from '../api/user'
import { toast } from '../utils/toast'
import { errorMessage } from '../utils/errors'

interface ImageUploaderProps {
  /** 图片上传成功后回调。传的是 OSS 上的公开地址。 */
  onUploaded: (url: string) => void
}

/**
 * 图片上传按钮。
 *
 * 流程跟群头像一样：签凭证 → 客户端直传 OSS → 把地址提交给后端。
 * 服务端不碰文件字节。
 *
 * 凭证是按 uid 签的（key 前缀锁在 chat_image/<uid>/），跟会话无关 ——
 * 所以这里不需要 conversationId。
 */
export function ImageUploader({ onUploaded }: ImageUploaderProps) {
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // 重置 input 的值 —— 选同一个文件两次也要能触发 change。
    e.target.value = ''
    if (!file) return

    setUploading(true)
    try {
      const ext = fileExt(file.name)
      const token: ImageUploadToken = await getImageUploadToken(ext)
      // 上传前先按后端给的额度拦一道 —— 别浪费一次注定失败的直传。
      const tooBig = checkFileSize(file.size, token.max_size)
      if (tooBig) {
        toast(tooBig, 'error')
        return
      }
      const url = await uploadToOSS(token, file)
      onUploaded(url)
    } catch (err) {
      toast(errorMessage(err, '图片上传失败'), 'error')
    } finally {
      setUploading(false)
    }
  }

  return (
    <>
      <button
        className="composer-icon-btn"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        title={uploading ? '上传中…' : '发送图片'}
        aria-label="发送图片"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </svg>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handlePick}
        disabled={uploading}
        hidden
      />
    </>
  )
}
