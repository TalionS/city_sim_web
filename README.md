# City Simulation Web

## 🔧 本地运行步骤

1. **创建虚拟环境（可选但推荐）**

```bash
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
```

2. **安装依赖**

```bash
pip install -r requirements.txt
```

3. **运行后端服务**（确保在 `backend/` 目录下）

```bash
python app.py
```

4. **打开网页前端**

直接用浏览器打开 `frontend/index.html`

> ✅ 如果你希望将前端托管到 Flask 服务里，我稍后可以帮你修改。

## 🧪 测试
- 使用多个浏览器窗口或设备访问 `index.html`
- 每次点击后，轮到下一个用户进行操作
- 页面提示将显示当前轮次
