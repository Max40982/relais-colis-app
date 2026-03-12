import React, { useState, useRef } from 'react';
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
  Image,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
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
  const [scanMode, setScanMode] = useState<'photo' | 'manual'>('manual');
  const [showPermissionScreen, setShowPermissionScreen] = useState(true);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isProcessingOCR, setIsProcessingOCR] = useState(false);
  
  const cameraRef = useRef<any>(null);

  const playSuccessFeedback = () => {
    if (Platform.OS !== 'web') {
      Vibration.vibrate(100);
    }
  };

  const playErrorFeedback = () => {
    if (Platform.OS !== 'web') {
      Vibration.vibrate([0, 100, 100, 100]);
    }
  };

  const takePicture = async () => {
    if (!cameraRef.current) return;
    
    try {
      setIsProcessingOCR(true);
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.7,
      });
      
      if (photo.base64) {
        setCapturedImage(`data:image/jpeg;base64,${photo.base64}`);
        
        // Send to OCR
        const response = await fetch(`${BACKEND_URL}/api/ocr`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ image_base64: photo.base64 }),
        });
        
        const result: OCRResponse = await response.json();
        
        if (result.success && result.name) {
          playSuccessFeedback();
          setManualName(result.name);
          setShowConfirmModal(true);
        } else {
          playErrorFeedback();
          Alert.alert(
            'Nom non trouvé',
            'Impossible de trouver le nom sur l\'étiquette. Voulez-vous l\'entrer manuellement ?',
            [
              { text: 'Réessayer', onPress: () => setCapturedImage(null) },
              { text: 'Manuel', onPress: () => {
                setCapturedImage(null);
                setScanMode('manual');
              }},
            ]
          );
        }
      }
    } catch (error) {
      console.error('Error taking picture:', error);
      playErrorFeedback();
      Alert.alert('Erreur', 'Impossible de prendre la photo');
    } finally {
      setIsProcessingOCR(false);
    }
  };

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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: name.trim() }),
      });

      const result: ScanResponse = await response.json();

      if (response.ok && result.success) {
        playSuccessFeedback();
        setLastResult(result);
        setShowResultModal(true);
        setManualName('');
        setCapturedImage(null);
      } else {
        playErrorFeedback();
        Alert.alert('Erreur', result.message || 'Une erreur est survenue');
      }
    } catch (error) {
      playErrorFeedback();
      console.error('Error processing scan:', error);
      Alert.alert('Erreur', 'Impossible de contacter le serveur');
    } finally {
      setIsLoading(false);
    }
  };

  const resetScanner = () => {
    setManualName('');
    setShowResultModal(false);
    setLastResult(null);
    setCapturedImage(null);
  };

  const fetchPackages = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/packages`);
      const data: PackageRecord[] = await response.json();
      setPackages(data);
    } catch (error) {
      console.error('Error fetching packages:', error);
      Alert.alert('Erreur', 'Impossible de charger la liste');
    }
  };

  const openPackageList = async () => {
    await fetchPackages();
    setShowListModal(true);
  };

  const handleRequestPermission = async () => {
    await requestPermission();
    setShowPermissionScreen(false);
    setScanMode('photo');
  };

  const handleManualMode = () => {
    setShowPermissionScreen(false);
    setScanMode('manual');
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

  // Show permission request screen only if needed and user hasn't bypassed it
  if (!permission.granted && showPermissionScreen && scanMode === 'photo') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Ionicons name="camera-outline" size={80} color="#666" />
          <Text style={styles.permissionTitle}>Accès Caméra Requis</Text>
          <Text style={styles.permissionText}>
            L'application a besoin d'accéder à la caméra pour photographier les étiquettes.
          </Text>
          <TouchableOpacity style={styles.permissionButton} onPress={handleRequestPermission}>
            <Text style={styles.permissionButtonText}>Autoriser la Caméra</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.permissionButton, { backgroundColor: '#34C759', marginTop: 12 }]} 
            onPress={handleManualMode}
          >
            <Text style={styles.permissionButtonText}>Mode Manuel</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Main app UI
  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>📦 Relais Colis</Text>
        <TouchableOpacity style={styles.listButton} onPress={openPackageList}>
          <Ionicons name="list" size={24} color="#FFF" />
        </TouchableOpacity>
      </View>

      {/* Mode Selector */}
      <View style={styles.modeSelector}>
        <TouchableOpacity
          style={[styles.modeButton, scanMode === 'photo' && styles.modeButtonActive]}
          onPress={() => {
            if (permission.granted) {
              setScanMode('photo');
            } else {
              setShowPermissionScreen(true);
              setScanMode('photo');
            }
          }}
        >
          <Ionicons name="camera-outline" size={20} color={scanMode === 'photo' ? '#FFF' : '#666'} />
          <Text style={[styles.modeButtonText, scanMode === 'photo' && styles.modeButtonTextActive]}>
            Photo
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeButton, scanMode === 'manual' && styles.modeButtonActive]}
          onPress={() => setScanMode('manual')}
        >
          <Ionicons name="pencil-outline" size={20} color={scanMode === 'manual' ? '#FFF' : '#666'} />
          <Text style={[styles.modeButtonText, scanMode === 'manual' && styles.modeButtonTextActive]}>
            Manuel
          </Text>
        </TouchableOpacity>
      </View>

      {/* Photo Mode */}
      {scanMode === 'photo' && permission.granted ? (
        <View style={styles.scannerContainer}>
          {capturedImage ? (
            <View style={styles.previewContainer}>
              <Image source={{ uri: capturedImage }} style={styles.previewImage} />
              {isProcessingOCR && (
                <View style={styles.ocrOverlay}>
                  <ActivityIndicator size="large" color="#FFF" />
                  <Text style={styles.ocrText}>Analyse de l'étiquette...</Text>
                </View>
              )}
            </View>
          ) : (
            <>
              <CameraView
                ref={cameraRef}
                style={styles.camera}
                facing="back"
              />
              <View style={styles.scanOverlay}>
                <View style={styles.labelFrame}>
                  <View style={[styles.scanCorner, styles.topLeft]} />
                  <View style={[styles.scanCorner, styles.topRight]} />
                  <View style={[styles.scanCorner, styles.bottomLeft]} />
                  <View style={[styles.scanCorner, styles.bottomRight]} />
                </View>
                <Text style={styles.scanHint}>
                  Cadrez le NOM du destinataire
                </Text>
              </View>
              <TouchableOpacity 
                style={styles.captureButton} 
                onPress={takePicture}
                disabled={isProcessingOCR}
              >
                {isProcessingOCR ? (
                  <ActivityIndicator color="#FFF" size="large" />
                ) : (
                  <Ionicons name="camera" size={40} color="#FFF" />
                )}
              </TouchableOpacity>
            </>
          )}
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

      {/* Confirmation Modal */}
      <Modal visible={showConfirmModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.successBadge}>
              <Ionicons name="checkmark-circle" size={40} color="#34C759" />
            </View>
            <Text style={styles.modalTitle}>Nom Trouvé !</Text>
            <Text style={styles.modalSubtitle}>Confirmez ou modifiez :</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Nom du destinataire"
              placeholderTextColor="#999"
              value={manualName}
              onChangeText={setManualName}
              autoCapitalize="words"
              autoCorrect={false}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => {
                  setShowConfirmModal(false);
                  setCapturedImage(null);
                  setManualName('');
                }}
              >
                <Text style={styles.cancelButtonText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton]}
                onPress={() => processName(manualName)}
                disabled={isLoading}
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
              {lastResult?.is_new ? 'Nouveau Destinataire' : 'Mis à Jour'}
            </Text>
            <Text style={styles.resultName}>{lastResult?.name}</Text>
            <Text style={styles.resultCount}>
              {lastResult?.package_count} colis
            </Text>
            <TouchableOpacity style={styles.resultButton} onPress={resetScanner}>
              <Ionicons name="add-circle" size={24} color="#FFF" />
              <Text style={styles.resultButtonText}>Ajouter un autre</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Package List Modal */}
      <Modal visible={showListModal} animationType="slide">
        <SafeAreaView style={styles.listModalContainer}>
          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>Colis en Attente</Text>
            <TouchableOpacity onPress={() => setShowListModal(false)}>
              <Ionicons name="close" size={28} color="#333" />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.packageList}>
            {packages.length === 0 ? (
              <View style={styles.emptyList}>
                <Ionicons name="cube-outline" size={60} color="#CCC" />
                <Text style={styles.emptyListText}>Aucun colis en attente</Text>
              </View>
            ) : (
              packages.map((pkg) => (
                <View key={pkg.id} style={styles.packageItem}>
                  <View style={styles.packageInfo}>
                    <Text style={styles.packageName}>{pkg.name}</Text>
                    <Text style={styles.packageStatus}>{pkg.statuts}</Text>
                  </View>
                  <View style={styles.packageCount}>
                    <Text style={styles.packageCountNumber}>{pkg.numero}</Text>
                    <Text style={styles.packageCountLabel}>colis</Text>
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
    backgroundColor: '#F5F5F5',
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFF',
  },
  listButton: {
    padding: 8,
  },
  modeSelector: {
    flexDirection: 'row',
    backgroundColor: '#E5E5E5',
    margin: 12,
    borderRadius: 12,
    padding: 4,
  },
  modeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6,
  },
  modeButtonActive: {
    backgroundColor: '#007AFF',
  },
  modeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  modeButtonTextActive: {
    color: '#FFF',
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
  labelFrame: {
    width: 320,
    height: 180,
    position: 'relative',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 8,
  },
  scanCorner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: '#00FF00',
  },
  topLeft: {
    top: -2,
    left: -2,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 8,
  },
  topRight: {
    top: -2,
    right: -2,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 8,
  },
  bottomLeft: {
    bottom: -2,
    left: -2,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 8,
  },
  bottomRight: {
    bottom: -2,
    right: -2,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 8,
  },
  scanHint: {
    marginTop: 20,
    fontSize: 16,
    color: '#FFF',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    fontWeight: '600',
  },
  captureButton: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#FFF',
  },
  previewContainer: {
    flex: 1,
    position: 'relative',
  },
  previewImage: {
    flex: 1,
    resizeMode: 'contain',
  },
  ocrOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  ocrText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
  },
  manualContainer: {
    flex: 1,
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
    backgroundColor: 'rgba(0,0,0,0.5)',
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
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
    textAlign: 'center',
  },
  modalInput: {
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
    borderWidth: 2,
    borderColor: '#E5E5E5',
    marginBottom: 20,
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
    backgroundColor: '#007AFF',
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
    marginBottom: 16,
  },
  newIcon: {
    backgroundColor: '#34C759',
  },
  updateIcon: {
    backgroundColor: '#007AFF',
  },
  resultTitle: {
    fontSize: 18,
    color: '#666',
    marginBottom: 8,
  },
  resultName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  resultCount: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#007AFF',
    marginBottom: 24,
  },
  resultButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 14,
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
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
  },
  packageInfo: {
    flex: 1,
  },
  packageName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  packageStatus: {
    fontSize: 14,
    color: '#007AFF',
    marginTop: 4,
  },
  packageCount: {
    alignItems: 'center',
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  packageCountNumber: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFF',
  },
  packageCountLabel: {
    fontSize: 12,
    color: '#FFF',
    opacity: 0.8,
  },
  refreshListButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    margin: 16,
    paddingVertical: 14,
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
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
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
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 30,
  },
  permissionButtonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '600',
  },
});
