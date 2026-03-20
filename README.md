# 🚁 FirstLight: AI-Driven Multi-Resolution Swarm Simulation
> "First light in the darkest hour"

**FirstLight** is an AI-powered platform for decentralized drone swarm coordination in disaster scenarios.  
Powered by **Google Gemini (Vertex AI)** and built on the **Model Context Protocol (MCP)**, it enables intelligent, autonomous search and rescue in environments where communication is limited or unavailable.

### 🎥 Presentation Video
[FirstLight Demo Video](https://youtu.be/i3pIPkwDmmo?si=ycniyABR2BYM9WXx)
<br/>
<sub>*(Click above to watch the project presentation and demo)*</sub>

### 📂 Presentation Slides
👉 [FirstLight Project Slides](./public/assets/FirstLight_Slides.zip)


### 📝 AI Logic Chain Documentation
Detailed documentation on the AI decision-making loop and chain-of-thought orchestration can be found here:<br>
👉 [AI Logic Chain (Full Documentation)](./AI_LOGIC_CHAIN.md) <br>

👉 [AI Logic Chain (Demo Video)](https://drive.google.com/file/d/1D_WHpD9I6JZl3VmFjgsQrfZWHRI4QB2h/view?usp=sharing)

---

## 👥 Our Team

We are a team passionate about building AI-powered drone systems to transform disaster response. By integrating advanced AI orchestration with autonomous swarms, we aim to provide first responders with **"FirstLight"** — a reliable eye in the sky that operates tirelessly, autonomously, and safely in environments where human access is limited.

![Our Team](./public/assets/ourteam.png)

| Member | Role | Responsibility |
| :--- | :--- | :--- |
| **Angela Ngu Xin Yi** | Leader | **AI Orchestration**: Managing the Gemini decision loop, prompt engineering, and tactical intent generation. |
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

## 🔌 MCP Architecture

<div align="center">
  <img src="./public/assets/mcp_architecture.drawio.svg" alt="MCP Architecture Diagram" width="80%" />
</div>

### Functional Layers
- **Strategic Planning (LLM)**: The high-level mission "Brain" (Gemini) that processes swarm state to develop search strategies and operational intent.
- **Mission Orchestrator (Relay Drone)**: Responsible for executing high-level tactical commands (e.g., `assignHotspotBatch`, `getRecommendedActions`) derived from the LLM strategy.
- **MCP Client (Transmission Bridge)**: The secure interface that links the **Cognition Engine** to the **MCP Server**, translating strategic intent into standardized JSON-RPC tool requests.
- **MCP Server (Tool Registry)**:
    - **High-Level Tools**: Strategic tools for mission-wide monitoring and tactical batching.
    - **Low-Level Tools**: Operational tools for individual drone perspective and maneuvers.
    - **Comm & Relay Tools**: Manage the mesh network status and positioning of relay drones.

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

## 🚀 Innovations

### 🌍 Geospatial Predictive Nature
-   **Initial Probability Fusion**: Survivor probability is calculated by fusing **Building Density**, **Residential Factors**, and **Road Access**.
-   **Prioritized Searching**: Instead of starting with a blank map, the model focuses early search efforts on **high-density residential areas** to speed up the localization process.

### 🛰️ Blanket Search (Dual-Mode)
-   **Wide Scan**: The default mode, which detects initial signs of survivors for **rapid area coverage**.
-   **Micro Scan**: Automatically activated when a drone detects a high signal probability, performing repeated, high-precision scans to **investigate the signal**.

### 🎛️ Collaborative & Adaptive Sensors
-   **Multi-Sensor Fusion**: Integrates various sensors (Mobile, Thermal, Wi-Fi, Sound) to compute accurate arrival probabilities.
-   **Confidence Building**: In Micro Scan mode, drone sensors' confidence **builds up over time** to eliminate noise-based false positives.
-   **Dynamic Weighting**: As survivors are found, the AI **"learns"** which sensors are most reliable and **adjusts their weights** in real-time.

### 🧠 Global Perspective of Orchestrator
-   **Semantic Summarization**: Raw telemetry is compressed into a **Natural Language Summary**, allowing the AI to read the battlefield and make strategic decisions like a human commander.
-   **Exact State Understanding**: Every 10 ticks, the entire grid and drone status are passed to the AI, ensuring it understands the **exact battery level, position, and scanned state** of every cell.

### 🔋 Resource & Time Management
-   **Battery Forecasting**: Before assignment, the system runs a **Battery Forecast** to ensure drones have enough energy to return to base to charge.
-   **Task Handoff**: When a drone's battery is low, it **negotiates a handoff** with the nearest drone, passing its high-probability coordinates so the investigation continues without interruption.
-   **Information Decay (TTL)**: Confidence levels in previous negative results **decay over time**, triggering **re-verification** of areas to account for a changing disaster environment.

### 🛡️ Self-Healing & Connectivity
-   **Autonomous Relay Rotation**: A backup relay at base replaces a low-battery relay in the field without dropping connectivity for a single tick.
-   **Centroid-Based Optimization**: If drones are almost losing connection, the relay **moves toward the centroid** of the swarm to maximize coverage.
-   **Offline Buffer Strategy**: Drones continue scanning and store data in a local **Offline Buffer** during signal loss, which is "flushed" to the base the moment a connection is restored for **zero data loss**.

### 🤖 Real-Time Drone Discovery & Adaptation
-   **Dynamic Discovery**: Instead of hard-coded IDs, the system uses a centralized `droneStore` and the `getDroneDiscoveryList` tool to enumerate the active fleet in real-time.
-   **Fleet-Agnostic Orchestration**: The AI orchestrator "sees" the currently synced fleet via `buildStateSummary`, ensuring it only issues commands to active, healthy drones without reinventing IDs.
-   **Autonomous Scaling**: The `executeRegionBootstrap` logic dynamically partitions the search grid (Region Centers) based on the current drone count—automatically scaling the strategy if the fleet grows or shrinks.
  
---

## 📊 Performance Analytics

To evaluate the effectiveness of our AI-driven search strategies, we monitored two key metrics across 100 simulation cycles: **Repeat Rate** and **Search Duration**.

### 📋 Summary Statistics

| Metric | Mean | Standard Deviation |
| :--- | :--- | :--- |
| **Search Duration (mm:ss)** | 2:27 | 0:33 |
| **Repeat Rate (%)** | 30.76% | 10.56% |

> [!TIP]
> **Detailed Data**: For the full raw data and calculations, you can download the [Performance Analysis Excel File](./public/assets/Performance_Analytics.xlsx).

### 📉 Repeat Rate Analysis
<div align="center">
  <img src="./public/assets/repeat_rate.svg" width="70%" />
</div>

The **Repeat Rate** shows a steady downward trend over time. This indicates that as the AI orchestrator learns the environment, it optimizes drone trajectories to prioritize unscanned sectors, significantly reducing redundant coverage and maximizing battery efficiency.

### ⏱️ Search Duration Analysis
<div align="center">
  <img src="./public/assets/search_duration.svg" width="70%" />
</div>

**Search Duration** remains stabilized around an average of **2:24 minutes**. Periodic peaks correspond to the activation of **"Micro Scan"** mode, where drones perform high-precision investigative loops upon detecting potential survivor signals, demonstrating the system's balance between rapid wide-area scanning and thorough localized search.

---


## 🛠️ Technologies Used

-   **AI & Orchestration Engine**: **Google Vertex AI (vertexai)** running state-of-the-art LLMs (**Gemini 2.5**) to act as the cognitive engine for autonomous mission planning and multi-agent coordination.
-   **Protocol & Backend Services**: **Node.js + Express + TypeScript** functioning as the **FirstLight MCP Server**. This acts as the bridge that standardizes communication between the AI orchestrator and the simulated drone components.
-   **Mission MCP Tools Modules**: Specialized MCP tools modules for drone control, scan intelligence, communication mesh status, relay operations, and orchestration policies.
-   **Frontend Simulation & Dashboard**: **React + TypeScript + Vite**, with interactive mission UI and operator chat/control panels.
-   **Geospatial & 3D Visualization**: **CesiumJS** (3D globe simulation), **Deck.gl** (Data overlays), **MapLibre-gl** (Mapping engine) and **Three.js** (Drone & FPV rendering) are deeply integrated for rendering a realistic 3D simulation map and providing dynamic FPV (First-Person View) Drone Cams.

---

## 💰 Business & Impact

### 1. Business Model

#### **GOVERNMENT & PUBLIC SAFETY (B2G LICENSING)**
-   **Annual Platform Licenses**: Tiered access for National Disaster Agencies (e.g., FEMA, ASEAN AHA Centre) and Civil Defense units.
-   **SOP Integration & Onboarding**: One-time setup fees for country-specific hazard mapping, language localization, and local agency protocol integration.
-   **Simulation as a Service**: Recurring subscriptions for AI-driven preparedness drills and digital-twin disaster scenarios.

#### **ENTERPRISE & INDUSTRIAL RESILIENCE (B2B)**
-   **Infrastructure Resilience Modules**: Emergency response AI designed to handle power grid failures and industrial accidents, ensuring continuous operations and business continuity.
-   **PaaS (Platform as a Service)**: A subscription tier for private responders and NGOs providing real-time probability heatmap APIs and updated MCP tool endpoints.
-   **Systems Integration**: Customizing the FirstLight MCP server to interface with bespoke legacy drone fleets or existing monitoring systems.

### 2. Market Segments

| Segment | Use Case | Standout Point |
| :--- | :--- | :--- |
| **Public Sector** (Govt, NGOs) | Rapid area scanning and survivor localization in the "Golden 72 Hours" post-disaster. | 10x faster than manual teams; real-time probability heatmaps for fast decision-making. |
| **Private Sector** (S&R Providers) | Missing persons in remote terrain and reconnaissance for industrial collapses or hazardous sites. | AI-driven prioritization significantly reduces operational risks for human rescuers. |
| **Humanitarian** (Aid Groups) | Urban S&R following airstrikes or infrastructure failure in GPS-denied/hostile environments. | Decentralized autonomy makes the system robust against jamming and signal loss. |

### 3. Competitor Analysis

| Solution | Strengths | Gaps |
| :--- | :--- | :--- |
| **Traditional Drone Systems** | Reliable hardware; mature ecosystem. | Human-dependent; requires continuous comms; limited blackout autonomy. |
| **Autonomous Drone Software** | Advanced navigation & perception; high autonomy. | Limited multi-agent coordination; weak decentralized orchestration. |
| **Defense-Grade Platforms** | Highly advanced; robust; high-end capabilities. | Extremely high cost; not scalable for developing regions. |
| **FirstLight** | **AI decision-making; battery & relay aware; self-healing; cost-effective.** | *N/A (Targeting gaps in existing solutions)* |

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

### 🌐 Live Demo
**https://firstlight-dashboard-494194863681.us-central1.run.app**

> **Note:** The AI Orchestrator may not function as expected in the live demo due to Google Cloud Run limitations. For the full orchestrator capabilities, running the simulation locally is recommended.

---


## 🔮 Future Improvements

-   **Sim-to-Real Edge Deployment (Local LLMs)**: Transitioning from cloud-based models (Vertex AI) to hyper-efficient, open-weights models (e.g., **Ollama/Llama**) running completely locally on edge compute nodes inside the disaster zone. This severs reliance on the cloud.
-   **Multi-Region Scaling**: Supporting simultaneous disaster zones with federated swarm coordination across provinces or countries.
-   **Higher-Fidelity Simulation**: Integrating weather dynamics, terrain obstruction, aftershock physics, and probabilistic sensor failure to further improve realism.


