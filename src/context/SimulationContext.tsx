import React, { createContext, useContext } from 'react';
import { useSimulationEngine } from '../hooks/useSimulationEngine';

export type SimulationContextType = ReturnType<typeof useSimulationEngine>;

const SimulationContext = createContext<SimulationContextType | null>(null);

export const SimulationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const simEngine = useSimulationEngine(
        (eventPayload) => {
            console.log("Failure triggered for", eventPayload.droneId);
        },
        () => {
            // handle play pause globally
        }
    );

    return (
        <SimulationContext.Provider value={simEngine}>
            {children}
        </SimulationContext.Provider>
    );
};

export const useSharedSimulation = () => {
    const context = useContext(SimulationContext);
    if (!context) {
        throw new Error("useSharedSimulation must be used within a SimulationProvider");
    }
    return context;
};
