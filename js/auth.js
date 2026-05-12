/**
 * Authentication Module - Quản lý authentication trên client
 */

class Auth {
    constructor() {
        this.API_URL = 'http://localhost:8000/api/v1';
        this.TOKEN_KEY = 'accessToken';
        this.USER_KEY = 'user';
    }
    
    /**
     * Lấy token từ localStorage
     */
    getToken() {
        return localStorage.getItem(this.TOKEN_KEY);
    }
    
    /**
     * Lấy user từ localStorage
     */
    getUser() {
        const user = localStorage.getItem(this.USER_KEY);
        return user ? JSON.parse(user) : null;
    }
    
    /**
     * Kiểm tra user đã đăng nhập hay chưa
     */
    isLoggedIn() {
        return !!this.getToken();
    }
    
    /**
     * Lưu token và user vào localStorage
     */
    saveAuth(token, user) {
        localStorage.setItem(this.TOKEN_KEY, token);
        localStorage.setItem(this.USER_KEY, JSON.stringify(user));
    }
    
    /**
     * Xóa token và user khỏi localStorage (logout)
     */
    clearAuth() {
        localStorage.removeItem(this.TOKEN_KEY);
        localStorage.removeItem(this.USER_KEY);
        localStorage.removeItem('savedUsername');
    }
    
    /**
     * Lấy header cho API request (có token)
     */
    getAuthHeaders() {
        const token = this.getToken();
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };
    }
    
    /**
     * Login
     */
    async login(username, password) {
        try {
            const response = await fetch(`${this.API_URL}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    username: username,
                    password: password
                })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Login failed');
            }
            
            const data = await response.json();
            this.saveAuth(data.access_token, data.user);
            return data;
        } catch (error) {
            console.error('Login error:', error);
            throw error;
        }
    }
    
    /**
     * Register
     */
    async register(username, email, password, fullName = '') {
        try {
            const response = await fetch(`${this.API_URL}/auth/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    username: username,
                    email: email,
                    password: password,
                    full_name: fullName || username
                })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Registration failed');
            }
            
            return await response.json();
        } catch (error) {
            console.error('Register error:', error);
            throw error;
        }
    }
    
    /**
     * Logout
     */
    logout() {
        this.clearAuth();
        window.location.href = 'login.html';
    }
    
    /**
     * Lấy thông tin user hiện tại từ server
     */
    async getCurrentUser() {
        try {
            const response = await fetch(`${this.API_URL}/auth/me`, {
                method: 'GET',
                headers: this.getAuthHeaders()
            });
            
            if (!response.ok) {
                if (response.status === 401) {
                    // Token expired
                    this.clearAuth();
                    window.location.href = 'login.html';
                }
                throw new Error('Failed to fetch user');
            }
            
            const user = await response.json();
            localStorage.setItem(this.USER_KEY, JSON.stringify(user));
            return user;
        } catch (error) {
            console.error('Get current user error:', error);
            throw error;
        }
    }
    
    /**
     * Kiểm tra token còn hợp lệ không
     */
    async verifyToken() {
        try {
            const response = await fetch(`${this.API_URL}/auth/me`, {
                method: 'GET',
                headers: this.getAuthHeaders()
            });
            
            return response.ok;
        } catch (error) {
            return false;
        }
    }
    
    /**
     * Chuyển hướng đến trang đăng nhập nếu chưa đăng nhập
     */
    requireLogin() {
        if (!this.isLoggedIn()) {
            window.location.href = 'login.html';
        }
    }
}

// Khởi tạo singleton
const auth = new Auth();

/**
 * Middleware để bảo vệ các trang cần authentication
 * Gọi function này trong <head> hoặc đầu file HTML
 */
function protectPage() {
    if (!auth.isLoggedIn()) {
        window.location.href = 'login.html';
    }
}

/**
 * Fetch wrapper với authentication
 */
async function apiFetch(endpoint, options = {}) {
    const headers = auth.getAuthHeaders();
    
    if (options.headers) {
        Object.assign(headers, options.headers);
    }
    
    const response = await fetch(`${auth.API_URL}${endpoint}`, {
        ...options,
        headers
    });
    
    // Handle 401 Unauthorized
    if (response.status === 401) {
        auth.clearAuth();
        window.location.href = 'login.html';
        throw new Error('Unauthorized');
    }
    
    return response;
}

/**
 * Helper để hiển thị user info di sidebar
 */
function displayUserInfo() {
    const user = auth.getUser();
    if (user) {
        const usernameEl = document.getElementById('userUsername');
        const roleEl = document.getElementById('userRole');
        
        if (usernameEl) usernameEl.textContent = user.username;
        if (roleEl) roleEl.textContent = user.role === 'admin' ? 'Quản trị viên' : 'Người dùng';
    }
}

/**
 * Logout handler
 */
function handleLogout() {
    if (confirm('Bạn có chắc chắn muốn đăng xuất?')) {
        auth.logout();
    }
}
