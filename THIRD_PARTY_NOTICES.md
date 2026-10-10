# 开源项目与第三方说明

发布与维护者：Arrow36。

## 网页运行依赖

当前版本没有第三方 JavaScript、CSS、字体、图片或 WASM 运行依赖。页面使用原生 HTML、CSS、JavaScript、Canvas、Web Worker 和浏览器文件 API；图标为本地 SVG，示例插画由 Canvas 本地绘制。

## 算法设计参考

| 项目 | 来源与许可证 | 使用方式 |
| --- | --- | --- |
| Long Shot RS | [项目](https://github.com/jswysnemc/long-shot-rs) · [MIT 许可证](https://github.com/jswysnemc/long-shot-rs/blob/v0.1.0/LICENSE) | 参考其文档中的边缘特征、模板匹配和置信度判断思路；没有复制、修改或分发该项目代码，没有使用其 Rust / OpenCV 依赖 |

SewShot 的粗匹配、原始滚动轴精校验、梯度相关性及稀疏文字校验为独立 JavaScript 实现。参考项目的后继项目为 [wayscrollshot](https://github.com/jswysnemc/wayscrollshot)，这里只提供项目去向说明，并未将其作为依赖。

## 开发与发布工具

| 项目 | 许可证信息 | 使用方式 |
| --- | --- | --- |
| Node.js | [许可证](https://github.com/nodejs/node/blob/main/LICENSE) | 本地执行内置 `node:test` 和语法检查；不随网页分发 |
| CPython | [许可证](https://docs.python.org/3/license.html) | 可选的本地 HTTP 静态服务器；不随网页分发 |
| Git | [GPL-2.0 及项目说明](https://git-scm.com/about/free-and-open-source) | 源码版本管理与远程推送；不随网页分发 |

GitHub Pages 是站点托管服务，不是打包到本项目中的开源库。上述工具各自的完整许可证以所链接的项目文件为准。
