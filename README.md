# napcat-plugin-index 

NapCat 插件索引仓库

##  插件提交指南

### 插件信息字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 插件唯一标识，建议格式：`napcat-plugin-xxx` |
| `name` | string | ✅ | 插件显示名称 |
| `version` | string | ✅ | 插件版本号，遵循 [SemVer](https://semver.org/) 规范 |
| `description` | string | ✅ | 插件简短描述 |
| `author` | string | ✅ | 作者名称 |
| `homepage` | string | ✅ | 插件主页/仓库地址 |
| `downloadUrl` | string | ✅ | 插件下载地址（zip 格式） |
| `tags` | string[] | ✅ | 插件标签，用于分类 |
| `minVersion` | string | ✅ | 支持的最低 NapCat 版本 |


### PR 提交要求

1. **Fork 本仓库** 并在自己的分支上进行修改
2. **确保 JSON 格式正确**，可使用 JSON 校验工具检查
3. **一个 PR 只做一件事**（新增/更新/删除一个插件）
4. **填写完整的 PR 描述**，说明变更内容

### 插件提交模板

```json
{
  "id": "napcat-plugin-example",
  "name": "示例插件",
  "version": "1.0.0",
  "description": "这是一个示例插件的描述",
  "author": "YourName",
  "homepage": "https://github.com/username/napcat-plugin-example",
  "downloadUrl": "https://github.com/username/napcat-plugin-example/releases/download/v1.0.0/napcat-plugin-example.zip",
  "tags": ["工具"],
  "minVersion": "4.14.0"
}
```

---

## ⚠️ 注意事项

1. 请确保插件 `id` 全局唯一
2. `downloadUrl` 必须是可直接下载的 zip 文件链接
3. 版本号更新时请同步更新 `plugins.v4.json` 中的 `updateTime` 字段
4. 提交前请在本地测试插件是否可正常下载和安装

---

## 📄 License

MIT License
