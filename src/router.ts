import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  scrollBehavior(to, _from, saved) {
    if (saved) return saved
    if (to.hash && !to.hash.startsWith('#/')) return { el: to.hash, top: 80 }
    return { top: 0 }
  },
  routes: [
    { path: '/', name: 'home', component: () => import('@/views/HomeView.vue') },
    { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue') },
    { path: '/join/:wid/:code', name: 'join', component: () => import('@/views/JoinView.vue') },
    // The level above worlds: worlds, campaigns, music rooms, the cabinet and the service admin. Every page — these
    // and the world pages — has the same top bar (AppBar).
    {
      path: '/',
      component: () => import('@/components/layout/HubLayout.vue'),
      children: [
        { path: 'worlds', name: 'worlds', component: () => import('@/views/WorldsView.vue') },
        {
          path: 'account', name: 'account', component: () => import('@/views/AccountView.vue'),
          // the worlds list and join requests used to be tabs of the cabinet: old links land in «Миры»
          beforeEnter: (to) => (to.query.tab === 'worlds' || to.query.tab === 'requests' ? { name: 'worlds', query: to.query.tab === 'requests' ? { tab: 'requests' } : {} } : true),
        },
        { path: 'campaigns', name: 'campaigns', component: () => import('@/views/CampaignsView.vue') },
        { path: 'c/:cid/:tab?', name: 'campaign', component: () => import('@/views/CampaignView.vue') },
        { path: 'cjoin/:cid/:code', name: 'campaignJoin', component: () => import('@/views/CampaignJoinView.vue') },
        { path: 'rooms', name: 'rooms', component: () => import('@/views/RoomsView.vue') },
        { path: 'r/:rid', name: 'room', component: () => import('@/views/RoomView.vue') },
        { path: 'admin/:tab?', name: 'admin', component: () => import('@/views/AdminView.vue') },
      ],
    },
    {
      path: '/w/:wid',
      component: () => import('@/views/WorldLayout.vue'),
      children: [
        { path: '', name: 'dashboard', component: () => import('@/views/DashboardView.vue') },
        { path: 't/:type', name: 'list', component: () => import('@/views/EntityListView.vue') },
        { path: 'e/:eid', name: 'entity', component: () => import('@/views/EntityView.vue') },
        { path: 'search', name: 'search', component: () => import('@/views/SearchView.vue') },
        { path: 'graph', name: 'graph', component: () => import('@/views/GraphView.vue') },
        { path: 'gallery', name: 'gallery', component: () => import('@/views/GalleryView.vue') },
        { path: 'settings/:tab?', name: 'settings', component: () => import('@/views/SettingsView.vue') },
      ],
    },
    // design lab: every kind of UI under six candidate designs (not linked from anywhere — open #/design by hand)
    { path: '/design', name: 'designLab', component: () => import('@/views/DesignLabView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
