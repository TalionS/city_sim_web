FROM python:3.12.4-slim

# 安装必要的系统依赖（gevent 需要）
RUN apt-get update && apt-get install -y build-essential gcc

WORKDIR /app

# 复制所有文件
COPY . .

# 安装依赖
RUN pip install --upgrade pip && pip install -r requirements.txt

# 设置环境变量
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# 启动 Flask-SocketIO 后端服务
CMD ["python", "backend/app.py"]