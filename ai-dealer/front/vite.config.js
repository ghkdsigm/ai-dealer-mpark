import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
	plugins: [vue()],
	server: {
		port: 5173,
		proxy: {
		  // 프론트에서 /api 로 오는 요청을 백엔드로 넘긴다
		  '/api': {
			target: 'http://localhost:3000', // 백엔드 실제 포트
			changeOrigin: true,
			// 필요 시 ^/api 제거 등 옵션 사용 가능
			// rewrite: (path) => path.replace(/^\/api/, '/api'),
		  },
		},
	  },
})
