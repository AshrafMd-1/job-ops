/**
 * Main App component.
 */

import React from "react";
import { Route, Routes } from "react-router-dom";

import { Toaster } from "@/components/ui/sonner";
import { OrchestratorPage } from "./pages/OrchestratorPage";
import { SettingsPage } from "./pages/SettingsPage";

export const App: React.FC = () => (
  <>
    <Routes>
      <Route path="/" element={<OrchestratorPage />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Routes>

    <Toaster position="bottom-right" richColors closeButton />
  </>
);