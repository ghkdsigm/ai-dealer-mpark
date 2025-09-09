import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
	plugins: [vue()],
	server: {
		proxy: {
			'/api': {
				target: 'http://localhost:3000',
				changeOrigin: true, // 프록시 헤더 원본 변경
				secure: false, // https 안 쓸 때 안전
				// rewrite: (path) => path.replace(/^\/api/, '/api'), // 필요 없음
			},
		},
	},
})
