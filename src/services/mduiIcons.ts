/**
 * Material Icons 字体（MDUI 的 <mdui-icon name="…"> 依赖它）。
 *
 * `<mdui-icon>` 内部渲染的是 `<span style="font-family: 'Material Icons'">名字</span>`，
 * 靠**字体连字（ligature）**把 `search` 这类文本渲染成图标。若不引入该字体，
 * 图标就会原样显示成文字——这是本项目之前的图标问题根因。
 *
 * 字体来自 @fontsource/material-icons（Apache-2.0，本地打包，不需要联网），
 * 只在 MDUI 主题真正加载时才引入，默认外观不增加包体。
 */
import "@fontsource/material-icons/400.css";
