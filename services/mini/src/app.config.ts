/**
 * [artifact:前端代码] — 小程序全局路由配置
 * 三个核心页面：仓库入库 / 工人任务 / QC检验
 */
export default defineAppConfig({
  pages: [
    'pages/worker-task/index',
    'pages/warehouse-inbound/index',
    'pages/qc-inspect/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#1a6eff',
    navigationBarTitleText: '智造管家',
    navigationBarTextStyle: 'white',
    backgroundColor: '#f5f6fa',
  },
  tabBar: {
    color: '#8a8a99',
    selectedColor: '#1a6eff',
    backgroundColor: '#ffffff',
    borderStyle: 'black',
    list: [
      {
        pagePath: 'pages/worker-task/index',
        text: '我的任务',
        iconPath: 'assets/icons/task.png',
        selectedIconPath: 'assets/icons/task-active.png',
      },
      {
        pagePath: 'pages/warehouse-inbound/index',
        text: '仓库入库',
        iconPath: 'assets/icons/warehouse.png',
        selectedIconPath: 'assets/icons/warehouse-active.png',
      },
      {
        pagePath: 'pages/qc-inspect/index',
        text: 'QC检验',
        iconPath: 'assets/icons/qc.png',
        selectedIconPath: 'assets/icons/qc-active.png',
      },
    ],
  },
})
