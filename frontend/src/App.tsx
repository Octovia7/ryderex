import { Navigate, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from './theme';
import { SessionProvider } from './auth/session';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { RequireRole } from './auth/RequireRole';
import { canAccessDriverRoutes, canAccessPassengerRoutes } from './auth/roles';
import { LoginScreen } from './routes/LoginScreen';
import { HomeScreen } from './routes/HomeScreen';
import { DriverHomeScreen } from './routes/DriverHomeScreen';
import { OfferRideScreen } from './routes/OfferRideScreen';
import { DriverRidesScreen } from './routes/DriverRidesScreen';
import { VehicleRegistrationScreen } from './routes/VehicleRegistrationScreen';
import { AccountScreen } from './routes/AccountScreen';
import { DriverApplicationScreen } from './routes/DriverApplicationScreen';
import { NotificationsScreen } from './routes/NotificationsScreen';
import { RoleDashboard } from './routes/RoleDashboard';
import { SearchScreen } from './routes/SearchScreen';
import { ResultsScreen } from './routes/ResultsScreen';
import { RideDetailScreen } from './routes/RideDetailScreen';
import { TripsScreen } from './routes/TripsScreen';

export function App() {
  return (
    <ThemeProvider>
      <SessionProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/search" replace />} />
          <Route path="/login" element={<LoginScreen />} />
          <Route element={<ProtectedRoute />}>
            {/* Universal: every authenticated account — PASSENGER, DRIVER,
                or ADMIN — can view/edit its own profile. Not role-gated. */}
            <Route path="/account" element={<AccountScreen />} />
            {/* Same universal protection as /account — the backend route
                itself carries no role gate either (only its own status
                guard). AccountScreen only ever links here for a PASSENGER
                whose driverLicenseStatus is null/REJECTED; this route
                doesn't re-enforce that, consistent with every other
                account-area screen here trusting its own entry point. */}
            <Route path="/account/driver-application" element={<DriverApplicationScreen />} />
            {/* Same universal protection — GET /notifications itself
                carries no role gate either, scoped purely by the caller's
                own id. */}
            <Route path="/notifications" element={<NotificationsScreen />} />

            {/* PASSENGER and DRIVER both get passenger capability — a driver
                hasn't stopped being a passenger. ADMIN does not. */}
            <Route element={<RequireRole isAllowed={canAccessPassengerRoutes} />}>
              <Route path="/app" element={<HomeScreen />} />
              <Route path="/search" element={<SearchScreen />} />
              <Route path="/results" element={<ResultsScreen />} />
              <Route path="/rides/:id" element={<RideDetailScreen />} />
              <Route path="/trips" element={<TripsScreen />} />
            </Route>

            {/* Driver-only capability: posting/managing rides. */}
            <Route element={<RequireRole isAllowed={canAccessDriverRoutes} />}>
              <Route path="/driver" element={<DriverHomeScreen />} />
              <Route path="/driver/offer" element={<OfferRideScreen />} />
              <Route path="/driver/rides" element={<DriverRidesScreen />} />
              <Route path="/driver/vehicle" element={<VehicleRegistrationScreen />} />
            </Route>

            {/* Admin is restricted to admin features only. */}
            <Route element={<RequireRole isAllowed={(role) => role === 'ADMIN'} />}>
              <Route path="/admin" element={<RoleDashboard title="Admin dashboard" />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SessionProvider>
    </ThemeProvider>
  );
}
