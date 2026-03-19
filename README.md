# 🚁 FirstLight: AI-Driven Multi-Resolution Swarm Simulation
> "First light in the darkest hour"

**FirstLight** is an AI-powered platform for decentralized drone swarm coordination in disaster scenarios.  
Powered by **Google Gemini (Vertex AI)** and built on the **Model Context Protocol (MCP)**, it enables intelligent, autonomous search and rescue in environments where communication is limited or unavailable.

---

## 👥 Our Team

We are a team passionate about building AI-powered drone systems to transform disaster response. By integrating advanced AI orchestration with autonomous swarms, we aim to provide first responders with **"FirstLight"** — a reliable eye in the sky that operates tirelessly, autonomously, and safely in environments where human access is limited.

| Member | Role | Responsibility |
| :--- | :--- | :--- |
| **Angela Ngu** | Leader | **AI Orchestration**: Managing the Gemini decision loop, prompt engineering, and tactical intent generation. |
| **Chun Yao Ting** | Member | **MCP Infrastructure**: Developing the MCP server, defining tool schemas, and ensuring robust state synchronization. |
| **Teoh Xin Yee** | Member | **Simulation Logic**: Implementing drone autonomous algorithms, heatmap probability modeling, and swarm coordination. |
| **Evelyn Ang** | Member | **Visualization & UI**: Developing Geospatial 3D views (Cesium/MapLibre), real-time telemetry overlays, and tactical interface styling. |

---

## 🔎 Project Overview

### 🚩 The Challenge: The 72-Hour Blackout
In the ASEAN region, typhoons and earthquakes frequently trigger catastrophic communication blackouts. 
- **Centralized Failure**: Current rescue models rely on high-bandwidth cloud connectivity for processing and coordination. When infrastructure collapses, these centralized systems fail.
- **The "Golden Window"**: During the first 72 hours, disaster response is stalled due to zero connectivity and lack of coordinated intelligence. There is an urgent need for an **Autonomous Command Agent** that operates at the edge, independent of human pilots or cloud access.

### 🌍 SDG Alignment
- **SDG 3**: Good Health & Well-being (Target 3.d — Emergency Preparedness)
- **SDG 9**: Industry, Innovation, & Infrastructure (Target 9.1 — Resilient Infrastructure)

### 💡 The Solution: Edge-Based Swarm Intelligence
FirstLight moves the "brain" of the operation to the disaster zone itself:
- **Autonomous Command**: A Gemini-powered agent that maps disaster zones and orchestrates a fleet of drones via on-device AI.
- **MCP Tool Protocol**: Standardized, efficient management of drone resources via the Model Context Protocol.
- **Self-Healing Swarms**: Real-time management of battery, connectivity, and mission handoffs to ensure aid reaches survivors.

---

## 🏗️ System Architecture
*(Section to be added)*

---

## 🔌 MCP Architecture
*(Section to be added)*

---

## 🔄 Mission Workflow

FirstLight operates in a continuous, high-fidelity orchestration loop:

```text
User launches FirstLight → Starts Simulation Scan
|
▼
Environment Sync → Ingest Map Tiles, Hazards, & Drone Telemetry
|
▼
Snapshot Generation → Anonymized JSON "World Model" Created
|
▼
AI Orchestration Loop (Gemini 2.5)
|
├── Analyze search grid probability (Heatmaps)
├── Evaluate battery & connectivity constraints
├── Strategize optimal hotspot allocation
└── Generate tactical intent
|
▼
MCP Action Execution → Translate intent to Discoverable Tools
|
├── setDroneTarget() → Direct movement
├── assignHotspotBatch() → Strategy dispatch
├── setDroneMode() → State transition
└── recallDroneToBase() → Safety management
|
▼
Swarm Execution & Feedback → Next Cycle Begins
|
├── Drones maneuver in 3D space
└── Sensor data streamed back to Simulation
```

> [!NOTE]  
> The workflow follows a strict **Sense → Think → Act** cycle, ensuring all drone maneuvers are grounded in real-time environmental data and strategic AI reasoning.

---

## 🌟 Key Features

### 🧠 AI-Powered Orchestration
*   **Gemini Engine**: Uses `gemini-2.0-flash` to analyze real-time simulation snapshots.
*   **Strategic Decision Making**: Dynamic pathfinding, battery management, and task allocation.
*   **Adaptive Search**: Intelligent hotspot detection based on probability heatmaps and terrain data.

### 🔌 MCP Integration
*   **Tool-Augmented Intelligence**: Exposes simulation controls (targeting, sensor queries, mission resets) as MCP tools.
*   **Unified Interface**: Seamless communication between the AI "Brain" and the simulation "Reality."

### 🗺️ Multi-Resolution Visualization
*   **Geospatial Fidelity**: Built with **CesiumJS**, **MapLibre**, and **Deck.gl** for high-performance 2D/3D mapping.
*   **Live Telemetry**: Real-time tracking of drone status, battery levels, and communication link health.
*   **Survivor Detection**: Visual indicators for found survivors and high-probability search zones.

---

## 🛠️ Technologies Used

-   **AI & Orchestration Engine**: **Google Vertex AI (Gemini 2.5)** acts as the cognitive engine for autonomous mission planning and multi-agent coordination.
-   **Protocol & Backend Services**: **Node.js + Express + TypeScript** functioning as the **FirstLight MCP Server**. This bridge standardizes communication between the AI orchestrator and simulated drone components.
-   **Frontend Simulation & Dashboard**: **React + TypeScript + Vite**, featuring an interactive mission UI and real-time operator chat/control panels.
-   **Geospatial & 3D Visualization**: **CesiumJS** (3D globe), **Deck.gl** (Data overlays), **MapLibre-gl** (Mapping engine), and **Three.js** (Drone & FPV rendering) are integrated to provide a realistic 3D simulation map and dynamic FPV (First-Person View) Drone Cams.
-   **Mission Logic Modules**: Specialized TypeScript modules for drone control, scan intelligence, communication mesh status, relay operations, and orchestration policies.

---

## 🚀 Getting Started

### Prerequisites

-   **Node.js** (v18+)
-   **Google Cloud Platform Project** with Vertex AI API enabled.
-   **Mapbox Access Token** (for certain map layers).

### Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/yaotingchun/FirstLight.git
    cd FirstLight
    ```

2.  **Install dependencies**:
    ```bash
    # Root (Frontend)
    npm install
    
    # Server (MCP)
    cd server
    npm install
    cd ..
    ```

3.  **Configure environment variables**:
    Create a `.env` file in the root and `server` folders (refer to `.env.example`).
    ```env
    GOOGLE_VERTEX_PROJECT=your-project-id
    GOOGLE_VERTEX_LOCATION=us-central1
    VITE_MAPBOX_TOKEN=your-mapbox-token
    ```

### Running the Simulation

1.  **Start the Frontend**:
    ```bash
    npm run dev
    ```

2.  **Start the MCP Server**:
    ```bash
    cd server
    npm run dev  # Or npm start
    ```

3.  **Run the AI Orchestrator** (Optional):
    ```bash
    # Run a continuous decision loop
    npm run orchestrator:loop
    ```

---


## 🔮 Future Improvements

-   **Sim-to-Real Edge Deployment (Local LLMs)**: Transitioning from cloud-based models (Vertex AI) to hyper-efficient, open-weights models (e.g., **Ollama/Llama**) running completely locally on edge compute nodes inside the disaster zone. This severs reliance on the cloud.
-   **Multi-Region Scaling**: Supporting simultaneous disaster zones with federated swarm coordination across provinces or countries.
-   **Higher-Fidelity Simulation**: Integrating weather dynamics, terrain obstruction, aftershock physics, and probabilistic sensor failure to further improve realism.


