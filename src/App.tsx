import { Navigate, RouterProvider, createHashRouter } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { HomePage } from "./pages/HomePage";
import { ExplorePage } from "./pages/ExplorePage";
import { FavoritesPage } from "./pages/FavoritesPage";
import { LibraryPage } from "./pages/LibraryPage";
import { ToolsPage } from "./pages/ToolsPage";
import { WorkDetailPage } from "./pages/WorkDetailPage";

const router = createHashRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "explore", element: <ExplorePage /> },
      { path: "library", element: <LibraryPage /> },
      { path: "library/:id", element: <WorkDetailPage /> },
      { path: "favorites", element: <FavoritesPage /> },
      { path: "tools", element: <ToolsPage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
