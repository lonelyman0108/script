# 🔧 全能签安装修复工具

    

## 🎯 功能简介

本项目旨在解决使用全能签安装App时，因证书问题导致App无法访问 `127.0.0.1` (本地回环地址)，从而安装失败的问题。

**工作原理**：
本脚本会拦截来自 `plist.nuosike.com`、`plist1.nuosike.com` 等域名的 `.plist` 配置文件请求，并将其中的 `127.0.0.1` 地址动态替换为您设备的**真实局域网IPv4地址**（例如 `192.168.1.10`）。这样，安装流程就能正确找到并下载App，从而完成安装。

## ⚙️ 安装与配置

请根据您使用的代理软件，选择对应的配置方法。

### **Surge**

**1. 复制模块链接**

    https://raw.githubusercontent.com/lonelyman0108/script/refs/heads/master/qnq_install_fix/surge/qnq_install_fix.sgmodule

**2. 在 Surge 中安装模块**

  * 打开 Surge App，切换到 `首页` -\> `模块`。
  * 点击 `安装新模块`，将复制的 URL 粘贴进去，点击 `好的`。
  * 确保在模块列表中，`全能签安装修复` 模块右侧的开关是**开启**状态。

**3. 确认 MitM 已启用**

  * 回到 Surge `首页`，点击 `MitM`。
  * 确保顶部的 `MitM` 总开关已开启，并已正确安装和信任 Surge CA 证书。
  * 模块会自动将所需的主机名 `plist*.nuosike.com` 添加到 MitM 主机名列表中。

### **Stash**

**1. 复制覆盖链接**

    https://raw.githubusercontent.com/lonelyman0108/script/refs/heads/master/qnq_install_fix/stash/qnq_install_fix.stoverride

**2. 在 Stash 中安装覆盖**

  * 打开 Stash App，进入 `设置` -\> `覆盖`。
  * 点击右上角的 `+` 号，选择 `从 URL 下载`。
  * 粘贴上方复制的链接，Stash 会自动下载并启用该覆盖。

**3. 确认 MitM 已启用**

  * 确保您的 Stash 配置中已启用 MitM，并已安装和信任 Stash 的 CA 证书。
  * 该覆盖会自动添加 `plist*.nuosike.com` 到 MitM 主机名列表。

### **Loon**

**1. 复制插件链接**

    https://raw.githubusercontent.com/lonelyman0108/script/refs/heads/master/qnq_install_fix/loon/qnq_install_fix.plugin

**2. 在 Loon 中添加插件**

  * 打开 Loon App，切换到 `配置` 标签页。
  * 找到并点击 `插件`，然后点击右上角的 `+` 号。
  * 将复制的链接粘贴到 `URL` 字段，点击 `确认` 添加。

**3. 确认 MitM 已启用**

  * 确保您已在 Loon 的 `配置` 中启用了 MitM，并正确安装了 CA 证书。
  * 插件会自动处理 `hostname`。

### **Shadowrocket**

**1. 复制模块链接**

    https://raw.githubusercontent.com/lonelyman0108/script/refs/heads/master/qnq_install_fix/shadowrocket/qnq_install_fix.module

**2. 在 Shadowrocket 中添加模块**

  * 打开 Shadowrocket，进入 `配置` 页面，点击一个配置文件进入编辑。
  * 在 `[Rule]` 部分上方添加 `[Module]` 段，然后粘贴模块链接。
  * 或者，直接通过 URL 导入模块。

**3. 确认 MitM 已启用**

  * 在 Shadowrocket 的 `配置` -\> `模块` 中启用 MitM，并确保 CA 证书已安装并受信任。
  * 模块会自动添加 `plist*.nuosike.com` 到 MitM 主机名。

### **Quantumult X**

**1. 复制配置文件链接**

    https://raw.githubusercontent.com/lonelyman0108/script/refs/heads/master/qnq_install_fix/qx/qnq_install_fix.conf
**2. 在 Quantumult X 中引用配置**

  * 打开 Quantumult X，点击右下角的 `风车` 图标，进入 `配置文件` -\> `编辑`。
  * 在 `[rewrite_local]` 部分，通过远程链接引用此配置文件。
  * 或者，在 `[General]` 下添加 `resource_parser_enable=true`，然后在 `[rewrite_remote]` 中添加链接。

**3. 确认 MitM 已启用**

  * 在 Quantumult X 的设置中，确保 MitM 已开启，并且证书已正确安装和信任。
  * 在 `[mitm]` 部分确保 `hostname = plist*.nuosike.com` 已被包含。

## 🚀 使用流程

安装和配置完成后，脚本将自动在后台工作。您只需：

1.  确保代理软件正在运行，且 MitM 功能已开启。
2.  正常通过全能签进行App安装。
3.  脚本会自动修改配置文件，您无需任何额外操作。

## ⚠️ 注意事项

  * **网络环境**：请确保您的设备已连接局域网，并且能够获取到真实的IPv4地址。
  * **个人项目**：本项目为个人兴趣驱动，仅供学习和交流使用，请勿用于商业用途。