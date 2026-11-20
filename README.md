# 一起玩 · Home Game

面向电视的家庭体感泡泡派对。1～2人合作，默认小手模式，60秒一局。索尼 PS4 体感摄像头连接 Omarchy 笔记本，HDMI 输出电视。视频和姿态均在本机处理，不使用麦克风、不录像、不上传。

## 本地运行

需要 Node 24。首次安装需网络下载依赖和官方模型，之后运行不依赖 CDN。

~~~sh
npm ci
npm run assets
npm run dev
~~~

打开 http://127.0.0.1:5173 。正式构建：

~~~sh
npm run build
npm start
~~~

打开 http://127.0.0.1:4173 。开发与预览服务仅监听 loopback。请勿通过改变host参数直接暴露到公网；此本地游戏不含在线身份系统。

## 首次设置

1. 在 Omarchy 完成摄像头固件加载并确认系统已可出画面。此项目不修改系统驱动、不自动注入固件。
2. 点击“连接摄像头”，在浏览器允许摄像头访问，然后选择正确设备。
3. 对照画面确认单眼裁剪。PS4原始格式可能包含双目、头部和额外区域，不能盲目裁半。可调整ROI的起点与宽高，画面只应出现一份人物。
4. 用HDMI连接电视，系统选择电视音频输出。初次全屏需要点击按钮或使用浏览器F11。
5. 每位玩家在各自位置举手2秒，再轻松伸手采样范围。画面中手光点跟着自己移动，确认后开始。

授权后，抬手指向菜单并停留1秒可选择。游戏中双手举起1.5秒或空格暂停。恢复有3秒倒计时。看不清手指时使用手腕，不要求复杂指法。需要重新选择设备或裁剪时由成年人操作。

“鼠标体验”有显著标识，只演示游戏规则，不代表摄像头识别结果。

## 质量与延迟

默认高质量：Full Pose、960长边采样、目标30次/秒。均衡：Lite/640/24；流畅：Lite/480/20。帧率是调度上限，不是设备性能承诺。画面绘制独立运行，识别Worker只保留一帧在途，超过150ms结果不计分。菜单启用精细手部识别，游戏中可选增强。

诊断显示渲染/识别频率、推理耗时与结果年龄；这些都不是“动作到电视”的物理延迟。目标PS4相机/Omarchy/HDMI尚未在当前开发环境验收，i5代际未知；1080p双人10分钟和高帧率相机测量仍需实机完成。可使用均衡档兼容当前集显，后续升级直接切高质量。

## 摄像头诊断

在目标Linux执行只读检查：

~~~sh
bash scripts/diagnose-camera.sh
~~~

需要工具时由系统管理员安装usbutils/v4l-utils。不要只按一个USB ID判断摄像头已就绪，也不要默认/dev/video0是PS4。先查看实际分辨率和帧率，再确认浏览器实际videoWidth/videoHeight与裁剪。

## 验证

~~~sh
npm run typecheck
npm test
npm run build
~~~

原交互原型保留在 prototype/；正式代码在 src/。主机测试与目标硬件测试分开记录；本地容器CLI当前缺失，宿主测试不冒充规定的容器最终验收。

## 模型与许可

运行库：@mediapipe/tasks-vision 1.2.3（Apache-2.0）。模型由官方版本化地址下载，来源、字节数与SHA256记录在 public/asset-manifest.json；public模型/WASM不加入Git，交付dist包含完整本地资源。

参考：[Pose Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker?tab=Web)、[Hand Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker?tab=Web)、[PS4EYECam采集布局](https://github.com/bigboss-ps3dev/PS4EYECam)。
