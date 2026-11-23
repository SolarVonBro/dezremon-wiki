import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import './styles/base.css'
import './styles/prose.css'
import './styles/layout.css'
// world themes after the base styles: equal-specificity token rules must come later to win
import './themes/themes1.css'
import './themes/themes2.css'
import './themes/themes3.css'
import './themes/site.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
