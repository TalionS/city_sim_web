from flask import Flask, request, send_from_directory
from flask_socketio import SocketIO, emit
from state import CityState
from gevent import monkey
from datetime import datetime
import csv
import os

# ========== 模型参数和日志 ==========
N = 1
M = 2
H = 100
rho0 = 0.5
m = 0.7
LOG_FILE = "/data/move_log.csv"

if not os.path.exists(LOG_FILE):
    with open(LOG_FILE, mode='w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow([
            "timestamp",
            "student_id",
            "from_idx",
            "to_idx",
            "delta_us",
            "delta_Us"
        ])

# ========== 打补丁，支持 gevent ==========
monkey.patch_all()

# ========== 设置静态资源路径 ==========
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "../frontend")

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path='')
socketio = SocketIO(app, cors_allowed_origins="*")

# ========== 提供前端页面 ==========
@app.route('/')
def serve_index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def serve_static_files(path):
    return send_from_directory(app.static_folder, path)

# ========== 初始化城市模型 ==========
city = CityState(N=N, M=M, H=H, rho0=rho0, m=m)

# ========== 客户端身份管理 ==========
clients = []
turn_index = 0

@socketio.on("connect")
def handle_connect():
    print("New client connected")
    emit("request_identity")
    emit("utility_config", {
        "type": "piecewise_linear",
        "params": {
            "m": city.m  
        }
    }, room=request.sid)
    emit("total_agents", {
        "total_agents": int(N * M * H * rho0)
    }, room=request.sid)

# @socketio.on("register")
# def handle_register(data):
#     global clients, turn_index
#     student_id = data.get("student_id")
#     if student_id not in clients:
#         clients.append(student_id)
#     print(f"{student_id} joined. Current clients: {clients}")

#     emit("state_update", city.to_dict(), broadcast=True)

#     emit("utility_config", {
#         "type": "piecewise_linear",
#         "params": {
#             "m": city.m  
#         }
#     }, room=request.sid)

#     if len(clients) == 1:
#         from_idx = city.get_random_agent_block()
#         socketio.emit("your_turn", {
#             "student_id": student_id,
#             "from_idx": from_idx,
#             "city": city.to_dict(from_idx)
#         })

# 建议全局保存
current_student = None
current_from_idx = None

@socketio.on("register")
def handle_register(data):
    global clients, turn_index, current_student, current_from_idx

    student_id = data.get("student_id")
    # 把 student_id 加入 clients 列表（注意去重）
    if student_id not in clients:
        clients.append(student_id)

    # 1) 给新加入者发一次 utility_config（你已有的话保留）
    emit("utility_config", {"type": "piecewise_linear", "params": {"m": city.m}})

    # 2) 给新加入者发一帧纯 city（含 social_utility），这样社福曲线能立刻动起来
    emit("state_update", city.to_dict())

    # 3) 如果还没有进行中的回合，就从第一个人开始并抽一个 from_idx
    if current_student is None or current_from_idx is None:
        turn_index = 0
        current_student = clients[turn_index]
        current_from_idx = city.get_random_agent_block()

        # 广播当前回合（带按 from_idx 计算过 Δ 的 city）
        socketio.emit("your_turn", {
            "student_id": current_student,
            "from_idx": current_from_idx,
            "city": city.to_dict(current_from_idx)
        })
    else:
        # 已有进行中的回合：至少把当前回合上下文发给**新加入者**，
        # 这样他不会一直看到 "Connecting..."
        emit("your_turn", {
            "student_id": current_student,
            "from_idx": current_from_idx,
            "city": city.to_dict(current_from_idx)
        })

@socketio.on("request_state")
def handle_state():
    emit("state_update", city.to_dict())

@socketio.on("move")
def handle_move(data):
    global turn_index, current_student, current_from_idx
    student_id = data.get("student_id")
    # from_idx = data.get("from_idx")
    # to_idx = data.get("to_idx")
    from_idx = int(data.get("from_idx"))
    to_idx = int(data.get("to_idx"))
    city.move(from_idx, to_idx)

    print(f"{student_id} moved from {from_idx} to {to_idx}")

    with open(LOG_FILE, mode='a', newline='') as f:
        writer = csv.writer(f)
        writer.writerow([
            datetime.now().isoformat(),
            student_id,
            from_idx,
            to_idx,
            city.delta_us,
            city.delta_Us
        ])

    socketio.emit("state_update", city.to_dict())

    if clients:
        turn_index = (turn_index + 1) % len(clients)
        next_student = clients[turn_index]
        from_idx = city.get_random_agent_block()
        socketio.emit("your_turn", {"student_id": next_student, "from_idx": from_idx, "city": city.to_dict(from_idx)})

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=8080)