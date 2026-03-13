import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  Platform,
  Vibration,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

// Types
interface ScanResponse {
  success: boolean;
  message: string;
  name: string;
  is_new: boolean;
  package_count: number;
  record_id?: string;
}

interface OCRResponse {
  success: boolean;
  name?: string;
  raw_text?: string;
  message: string;
}

interface PackageRecord {
  id: string;
  name: string;
  numero: number;
  statuts: string;
  note?: string;
}

export default function ScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [manualName, setManualName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [lastResult, setLastResult] = useState<ScanResponse | null>(null);
  const [showResultModal, setShowResultModal] = useState(false);
  const [showListModal, setShowListModal] = useState(false);
  const [packages, setPackages] = useState<PackageRecord[]>([]);
  const [scanMode, setScanMode] = useState<'auto' | 'manual'>('auto');
  const [showPermissionScreen, setShowPermissionScreen] = useState(true);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState('Recherche du nom...');
  const [detectedName, setDetectedName] = useState<string | null>(null);
  
  const cameraRef = useRef<any>(null);
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isProcessingRef = useRef(false);
  const soundRef = useRef<Audio.Sound | null>(null);

  // Load success sound
  useEffect(() => {
    loadSound();
    return () => {
      unloadSound();
      stopAutoScan();
    };
  }, []);

  const loadSound = async () => {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });
    } catch (error) {
      console.log('Error setting audio mode:', error);
    }
  };

  const unloadSound = async () => {
    if (soundRef.current) {
      await soundRef.current.unloadAsync();
    }
  };

  const playSuccessSound = async () => {
    try {
      // Play system sound via vibration pattern
      if (Platform.OS !== 'web') {
        Vibration.vibrate([0, 50, 50, 50, 50, 50]);
      }
      
      // Try to play a beep sound
      const { sound } = await Audio.Sound.createAsync(
        { uri: 'https://www.soundjay.com/buttons/beep-01a.mp3' },
        { shouldPlay: true, volume: 1.0 }
      );
      soundRef.current = sound;
      
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync();
        }
      });
    } catch (error) {
      // Fallback to vibration only
      if (Platform.OS !== 'web') {
        Vibration.vibrate([0, 100, 50, 100]);
      }
    }
  };

  const playErrorSound = async () => {
    if (Platform.OS !== 'web') {
      Vibration.vibrate([0, 200, 100, 200]);
    }
  };

  // Auto scan function
  const autoScan = useCallback(async () => {
    if (!cameraRef.current || isProcessingRef.current || !isScanning) return;
    
    isProcessingRef.current = true;
    
    try {
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.2,
        skipProcessing: true,
        exif: false,
      });
      
      if (photo.base64) {
        const response = await fetch(`${BACKEND_URL}/api/ocr`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_base64: photo.base64 }),
        });
        
        const result: OCRResponse = await response.json();
        
        if (result.success && result.name) {
          // Name found! Stop scanning and show confirmation
          stopAutoScan();
          setDetectedName(result.name);
          setManualName(result.name);
          await playSuccessSound();
          setShowConfirmModal(true);
        }
      }
    } catch (error) {
      console.log('Auto scan error:', error);
    } finally {
      isProcessingRef.current = false;
    }
  }, [isScanning]);

  const startAutoScan = useCallback(() => {
    if (scanIntervalRef.current) return;
    
    setIsScanning(true);
    setScanStatus('Recherche du nom...');
    setDetectedName(null);
    
    // Start scanning every 1.5 seconds
    scanIntervalRef.current = setInterval(() => {
      autoScan();
    }, 1500);
    
    // Also do immediate scan
    setTimeout(autoScan, 500);
  }, [autoScan]);

  const stopAutoScan = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    setIsScanning(false);
    isProcessingRef.current = false;
  }, []);

  // Start auto scan when camera is ready and mode is auto
  useEffect(() => {
    if (permission?.granted && scanMode === 'auto' && !showConfirmModal && !showResultModal) {
      const timer = setTimeout(() => {
        startAutoScan();
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      stopAutoScan();
    }
  }, [permission?.granted, scanMode, showConfirmModal, showResultModal]);

  const processName = async (name: string) => {
    if (!name.trim()) {
      Alert.alert('Erreur', 'Le nom ne peut pas être vide');
      return;
    }

    setIsLoading(true);
    setShowConfirmModal(false);

    try {
      const response = await fetch(`${BACKEND_URL}/api/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });

      const result: ScanResponse = await response.json();

      if (response.ok && result.success) {
        await playSuccessSound();
        setLastResult(result);
        setShowResultModal(true);
        setManualName('');
        setDetectedName(null);
      } else {
        await playErrorSound();
        Alert.alert('Erreur', result.message || 'Une erreur est survenue');
      }
    } catch (error) {
      await playErrorSound();
      Alert.alert('Erreur', 'Impossible de contacter le serveur');
    } finally {
      setIsLoading(false);
    }
  };

  const resetScanner = () => {
    setManualName('');
    setShowResultModal(false);
    setLastResult(null);
    setDetectedName(null);
    // Auto scan will restart via useEffect
  };

  const fetchPackages = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/packages`);
      const data: PackageRecord[] = await response.json();
      setPackages(data);
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de charger la liste');
    }
  };

  const openPackageList = async () => {
    stopAutoScan();
    await fetchPackages();
    setShowListModal(true);
  };

  const handleRequestPermission = async () => {
    await requestPermission();
    setShowPermissionScreen(false);
  };

  const handleManualMode = () => {
    setShowPermissionScreen(false);
    setScanMode('manual');
    stopAutoScan();
  };

  // Loading state
  if (!permission) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Chargement...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Permission screen
  if (!permission.granted && showPermissionScreen) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Ionicons name="scan-outline" size={80} color="#007AFF" />
          <Text style={styles.permissionTitle}>Scan Automatique</Text>
          <Text style={styles.permissionText}>
            Autorisez la caméra pour scanner automatiquement les étiquettes.
          </Text>
          <TouchableOpacity style={styles.permissionButton} onPress={handleRequestPermission}>
            <Text style={styles.permissionButtonText}>Autoriser</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.permissionButton, { backgroundColor: '#666', marginTop: 12 }]} 
            onPress={handleManualMode}
          >
            <Text style={styles.permissionButtonText}>Mode Manuel</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Main UI
  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>📦 Relais Colis</Text>
        <View style={styles.headerButtons}>
          <TouchableOpacity 
            style={styles.headerButton} 
            onPress={() => {
              if (scanMode === 'auto') {
                stopAutoScan();
                setScanMode('manual');
              } else {
                setScanMode('auto');
              }
            }}
          >
            <Ionicons 
              name={scanMode === 'auto' ? 'scan' : 'pencil'} 
              size={22} 
              color="#FFF" 
            />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerButton} onPress={openPackageList}>
            <Ionicons name="list" size={22} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Camera / Manual Mode */}
      {scanMode === 'auto' && permission.granted ? (
        <View style={styles.scannerContainer}>
          <CameraView
            ref={cameraRef}
            style={styles.camera}
            facing="back"
          />
          <View style={styles.scanOverlay}>
            {/* Scan frame */}
            <View style={styles.scanFrame}>
              <View style={[styles.scanCorner, styles.topLeft]} />
              <View style={[styles.scanCorner, styles.topRight]} />
              <View style={[styles.scanCorner, styles.bottomLeft]} />
              <View style={[styles.scanCorner, styles.bottomRight]} />
              
              {/* Scanning indicator */}
              {isScanning && (
                <View style={styles.scanningIndicator}>
                  <ActivityIndicator size="small" color="#00FF00" />
                </View>
              )}
            </View>
            
            {/* Status */}
            <View style={styles.statusContainer}>
              {isScanning ? (
                <>
                  <ActivityIndicator size="small" color="#FFF" />
                  <Text style={styles.statusText}>{scanStatus}</Text>
                </>
              ) : (
                <Text style={styles.statusText}>Scan en pause</Text>
              )}
            </View>

            {/* Instructions */}
            <Text style={styles.instructionText}>
              Placez le NOM du destinataire dans le cadre
            </Text>
          </View>
        </View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.manualContainer}
        >
          <View style={styles.manualContent}>
            <Ionicons name="person-outline" size={60} color="#007AFF" />
            <Text style={styles.manualTitle}>Saisie Manuelle</Text>
            <TextInput
              style={styles.manualInput}
              placeholder="Nom du destinataire"
              placeholderTextColor="#999"
              value={manualName}
              onChangeText={setManualName}
              autoCapitalize="words"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[styles.submitButton, !manualName.trim() && styles.submitButtonDisabled]}
              onPress={() => processName(manualName)}
              disabled={!manualName.trim() || isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={24} color="#FFF" />
                  <Text style={styles.submitButtonText}>Valider</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}

      {/* Confirmation Modal - Name Detected */}
      <Modal visible={showConfirmModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.successBadge}>
              <Ionicons name="checkmark-circle" size={50} color="#34C759" />
            </View>
            <Text style={styles.modalTitle}>Nom Détecté !</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Nom du destinataire"
              placeholderTextColor="#999"
              value={manualName}
              onChangeText={setManualName}
              autoCapitalize="words"
              autoCorrect={false}
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => {
                  setShowConfirmModal(false);
                  setManualName('');
                  setDetectedName(null);
                }}
              >
                <Text style={styles.cancelButtonText}>Réessayer</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton]}
                onPress={() => processName(manualName)}
                disabled={isLoading || !manualName.trim()}
              >
                {isLoading ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.confirmButtonText}>Valider</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Result Modal */}
      <Modal visible={showResultModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, styles.resultModal]}>
            <View style={[styles.resultIcon, lastResult?.is_new ? styles.newIcon : styles.updateIcon]}>
              <Ionicons
                name={lastResult?.is_new ? 'person-add' : 'refresh-circle'}
                size={50}
                color="#FFF"
              />
            </View>
            <Text style={styles.resultTitle}>
              {lastResult?.is_new ? 'Nouveau' : 'Mis à Jour'}
            </Text>
            <Text style={styles.resultName}>{lastResult?.name}</Text>
            <Text style={styles.resultCount}>
              {lastResult?.package_count} colis
            </Text>
            <TouchableOpacity style={styles.resultButton} onPress={resetScanner}>
              <Ionicons name="scan" size={24} color="#FFF" />
              <Text style={styles.resultButtonText}>Suivant</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Package List Modal */}
      <Modal visible={showListModal} animationType="slide">
        <SafeAreaView style={styles.listModalContainer}>
          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>En Attente</Text>
            <TouchableOpacity onPress={() => setShowListModal(false)}>
              <Ionicons name="close" size={28} color="#333" />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.packageList}>
            {packages.length === 0 ? (
              <View style={styles.emptyList}>
                <Ionicons name="cube-outline" size={60} color="#CCC" />
                <Text style={styles.emptyListText}>Aucun colis</Text>
              </View>
            ) : (
              packages.map((pkg) => (
                <View key={pkg.id} style={styles.packageItem}>
                  <View style={styles.packageInfo}>
                    <Text style={styles.packageName}>{pkg.name}</Text>
                  </View>
                  <View style={styles.packageCount}>
                    <Text style={styles.packageCountNumber}>{pkg.numero}</Text>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
          <TouchableOpacity style={styles.refreshListButton} onPress={fetchPackages}>
            <Ionicons name="refresh" size={20} color="#FFF" />
            <Text style={styles.refreshListButtonText}>Actualiser</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </Modal>

      {/* Loading Overlay */}
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Enregistrement...</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#F5F5F5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFF',
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  headerButton: {
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
  },
  scannerContainer: {
    flex: 1,
    position: 'relative',
  },
  camera: {
    flex: 1,
  },
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanFrame: {
    width: 300,
    height: 150,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanCorner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderColor: '#00FF00',
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
  },
  scanningIndicator: {
    position: 'absolute',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 8,
  },
  statusText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  instructionText: {
    position: 'absolute',
    bottom: 50,
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  manualContainer: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  manualContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  manualTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 16,
    marginBottom: 24,
  },
  manualInput: {
    width: '100%',
    backgroundColor: '#FFF',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
    borderWidth: 2,
    borderColor: '#E5E5E5',
    marginBottom: 20,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#34C759',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 30,
    gap: 8,
  },
  submitButtonDisabled: {
    backgroundColor: '#CCC',
  },
  submitButtonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 24,
    width: '85%',
    maxWidth: 400,
  },
  successBadge: {
    alignItems: 'center',
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    marginBottom: 16,
  },
  modalInput: {
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 20,
    fontWeight: '600',
    borderWidth: 2,
    borderColor: '#007AFF',
    marginBottom: 20,
    textAlign: 'center',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#F5F5F5',
  },
  cancelButtonText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '600',
  },
  confirmButton: {
    backgroundColor: '#34C759',
  },
  confirmButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  resultModal: {
    alignItems: 'center',
  },
  resultIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  newIcon: {
    backgroundColor: '#34C759',
  },
  updateIcon: {
    backgroundColor: '#007AFF',
  },
  resultTitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 4,
  },
  resultName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  resultCount: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#007AFF',
    marginBottom: 20,
  },
  resultButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 30,
    gap: 8,
  },
  resultButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  listModalContainer: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFF',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  listTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  packageList: {
    flex: 1,
    padding: 12,
  },
  emptyList: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyListText: {
    fontSize: 16,
    color: '#999',
    marginTop: 12,
  },
  packageItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFF',
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
  },
  packageInfo: {
    flex: 1,
  },
  packageName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  packageCount: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  packageCountNumber: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFF',
  },
  refreshListButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    margin: 16,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  refreshListButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#FFF',
  },
  permissionTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 20,
    marginBottom: 12,
  },
  permissionText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 24,
  },
  permissionButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 30,
  },
  permissionButtonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '600',
  },
});
