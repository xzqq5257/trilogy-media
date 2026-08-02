---
title: Trilogy · 读 · 听 · 乐
sdk: docker
app_port: 7860
emoji: 🎙️
license: mit
short_description: 读书 · 听书（用户自定声源模拟克隆）· 听音乐，三合一应用
---

# Trilogy Media — 读 · 听 · 乐

三合一应用：沉浸式阅读 · 用用户上传素材模拟克隆的专属声源朗读 · 氛围音乐 + 本地音乐导入播放。

## 功能

- 📖 **读书**：多本预置书籍，支持章节切换、字号调节、舒适排版
- 🎧 **听书**：上传任意视频/音频作为素材，系统模拟出独一无二的朗读声源（音高/语速/温暖度/半音偏移由素材内容指纹确定性生成，可保存多份，随时切换；逐句高亮、进度条、自动连播
- 🎵 **音乐**：ffmpeg 合成的 4 首氛围音乐 + 支持本地音频上传导入，底部常驻播放器条，播放/暂停/上一首/下一首/进度拖动

## 本地运行

```bash
npm install
npm run dev   # 后端 :8787 + 前端 :5173
```

## 部署到 Hugging Face Spaces

### 方式 A：网页操作

1. 创建 Space：https://huggingface.co/new-space
   - Space SDK：选择 **Docker**
   - Docker template：**Blank**
2. 选择下面**通过 GitHub 导入本仓库
3. 等待构建（10-15 分钟）
4. 建议进入 Space Settings → **Persistent storage** 挂载 200GB，重启一下，不然数据不持久化

### 方式 B：用 huggingface_hub CLI

```bash
pip install -U huggingface_hub
huggingface-cli login
huggingface-cli repo create trilogy-media --type space --sdk docker
# 把本目录整体推送到 Space 仓库（不是 push 会自动构建）
```
