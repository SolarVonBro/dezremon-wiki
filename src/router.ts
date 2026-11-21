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
    // The level above worlds: one top bar (HubLayout) for the cabinet, campaigns and the service admin.
    {
      path: '/',
      component: () => import('@/components/layout/HubLayout.vue'),
      children: [
        { path: 'account', name: 'account', component: () => import('@/views/AccountView.vue') },
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
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
