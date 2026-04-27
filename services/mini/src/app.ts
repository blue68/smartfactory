/**
 * [artifact:前端代码] — 小程序应用入口
 * 负责全局初始化：Token 加载、错误边界、全局样式
 */
import { Component } from 'react'
import './app.css'

class App extends Component {
  /**
   * 应用启动时同步本地 Token，确保 request.ts 可读取
   * wx.getStorageSync 是同步 API，在 onLaunch 阶段可安全调用
   */
  componentDidMount() {
    // Token 由 request.ts 从 storage 读取，此处无需额外操作
    // 后续可在此处接入微信登录静默授权流程
  }

  // 小程序切后台
  componentDidHide() {}

  // 小程序切前台
  componentDidShow() {}

  render() {
    // this.props.children 是当前激活的页面组件，由 Taro 自动注入
    // @ts-expect-error Taro 运行时会注入 children，React.Component 默认 props 类型未声明该字段。
    return this.props.children
  }
}

export default App
