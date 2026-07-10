import axios, { AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';

// In-memory access token storage
let accessTokenMemory: string | null = null;
let onTokenRefreshedCallback: ((token: string | null) => void) | null = null;

// Axios instance
export const apiClient = axios.create({
  baseURL: (import.meta.env.VITE_API_URL as string) || 'http://localhost:3000/api/v1',
  withCredentials: true, // Crucial for receiving/sending HttpOnly cookies
  headers: {
    'Content-Type': 'application/json',
  },
});

export const setAccessToken = (token: string | null) => {
  accessTokenMemory = token;
  if (onTokenRefreshedCallback) {
    onTokenRefreshedCallback(token);
  }
};

export const getAccessToken = () => {
  return accessTokenMemory;
};

export const registerOnTokenRefreshed = (cb: (token: string | null) => void) => {
  onTokenRefreshedCallback = cb;
};

// Outbound request interceptor: attach Authorization header
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    if (accessTokenMemory && config.headers) {
      config.headers['Authorization'] = `Bearer ${accessTokenMemory}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor: automatically handles 401 token refresh retry
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value: string | PromiseLike<string>) => void;
  reject: (reason?: any) => void;
}> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else if (token) {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

    // If 401 error, and request wasn't already a retry or a login request
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      originalRequest.url &&
      !originalRequest.url.includes('/auth/business/login') &&
      !originalRequest.url.includes('/auth/rider/verify-otp') &&
      !originalRequest.url.includes('/auth/refresh')
    ) {
      if (isRefreshing) {
        // Queue this request while token is refreshing
        return new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            if (originalRequest.headers) {
              originalRequest.headers['Authorization'] = `Bearer ${token}`;
            }
            return apiClient(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // Attempt silent refresh
        const refreshResponse = await apiClient.post<{ accessToken: string }>('/auth/refresh');
        const nextToken = refreshResponse.data.accessToken;

        setAccessToken(nextToken);
        processQueue(null, nextToken);

        isRefreshing = false;

        // Replay original request
        if (originalRequest.headers) {
          originalRequest.headers['Authorization'] = `Bearer ${nextToken}`;
        }
        return apiClient(originalRequest);
      } catch (refreshErr) {
        processQueue(refreshErr, null);
        isRefreshing = false;
        setAccessToken(null); // Clear session
        return Promise.reject(refreshErr);
      }
    }

    return Promise.reject(error);
  }
);
