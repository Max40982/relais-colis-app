import React, { useState, useRef, useEffect } from 'react';
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

interface ScanResponse {
  success: boolean;
  message: string;
  name: string;
  is_new: boolean;
  package_count: number;
}

interface OCRResponse {
  success: boolean;
  name?: string;
  message: string;
}

interface PackageRecord {
  id: string;
  name: string;
  numero: number;
  statuts: string;
}

export default function ScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [manualName, setManualName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [lastResult, setLastResult] = useState<ScanResponse | null>(null);
  const [showResultModal, setShowResultModal] = useState(false);
  const [showListModal, setShowListModal] = useState(false);
  const [packages, setPackages] = useState<PackageRecord[]>([]);
  const [scanMode, setScanMode] = useState<'photo' | 'manual'>('photo');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  
  const cameraRef = useRef<any>(null);

  useEffect(() => {
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
  }, []);

  const playSound = async (success: boolean) => {
    try {
      if (Platform.OS !== 'web') {
        Vibration.vibrate(success ? [0, 50, 30, 50] : [0, 100, 50, 100]);
      }
      const { sound } = await Audio.Sound.createAsync(
        { uri: success ? 'https://www.soundjay.com/buttons/beep-01a.mp3' : 'https://www.soundjay.com/buttons/beep-02.mp3' },
        { shouldPlay: true }
      );
      sound.setOnPlaybackStatusUpdate((s) => { if (s.isLoaded && s.didJustFinish) sound.unloadAsync(); });
    } catch (e) {
      if (Platform.OS !== 'web') Vibration.vibrate(100);
    }
  };

  const takePicture = async () => {
    if (!cameraRef.current || isScanning) return;
    
    setIsScanning(true);
    
    try {
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.2,
        skipProcessing: true,
      });
      
      if (photo.base64) {
        const response = await fetch(`${BACKEND_URL}/api/ocr`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_base64: photo.base64 }),
        });
        
        const result: OCRResponse = await response.json();
        
        if (result.success && result.name) {
          await playSound(true);
          setManualName(result.name);
          setShowConfirmModal(true);
        } else {
          await playSound(false);
          Alert.alert('Nom non trouvé', 'Réessayez ou utilisez le mode manuel', [
            { text: 'OK' },
            { text: 'Manuel', onPress: () => setScanMode('manual') }
          ]);
        }
      }
    } catch (error) {
      await playSound(false);
      Alert.alert('Erreur', 'Problème de connexion');
    } finally {
      setIsScanning(false);
    }
  };

  const processName = async (name: string) => {
    if (!name.trim()) return;
    
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
        await playSound(true);
        setLastResult(result);
        setShowResultModal(true);
        setManualName('');
      } else {
        await playSound(false);
        Alert.alert('Erreur', result.message);
      }
    } catch (error) {
      await playSound(false);
      Alert.alert('Erreur', 'Connexion impossible');
    } finally {
      setIsLoading(false);
    }
  };

  const resetScanner = () => {
    setManualName('');
    setShowResultModal(false);
    setLastResult(null);
  };

  const fetchPackages = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/packages`);
      setPackages(await response.json());
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de charger');
    }
  };

  if (!permission) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#007AFF" />
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Ionicons name="camera" size={60} color="#007AFF" />
          <Text style={styles.title}>Autoriser la caméra</Text>
          <TouchableOpacity style={styles.btn} onPress={requestPermission}>
            <Text style={styles.btnText}>Autoriser</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, {backgroundColor: '#666', marginTop: 10}]} onPress={() => setScanMode('manual')}>
            <Text style={styles.btnText}>Mode Manuel</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>📦 Relais Colis</Text>
        <View style={styles.headerBtns}>
          <TouchableOpacity style={styles.headerBtn} onPress={() => setScanMode(scanMode === 'photo' ? 'manual' : 'photo')}>
            <Ionicons name={scanMode === 'photo' ? 'pencil' : 'camera'} size={20} color="#FFF" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerBtn} onPress={() => { fetchPackages(); setShowListModal(true); }}>
            <Ionicons name="list" size={20} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Camera Mode */}
      {scanMode === 'photo' ? (
        <View style={styles.cameraContainer}>
          <CameraView ref={cameraRef} style={styles.camera} facing="back" />
          <View style={styles.overlay}>
            <View style={styles.frame}>
              <View style={[styles.corner, styles.tl]} />
              <View style={[styles.corner, styles.tr]} />
              <View style={[styles.corner, styles.bl]} />
              <View style={[styles.corner, styles.br]} />
            </View>
            <Text style={styles.hint}>Cadrez le NOM puis appuyez</Text>
          </View>
          <TouchableOpacity 
            style={[styles.captureBtn, isScanning && styles.captureBtnDisabled]} 
            onPress={takePicture}
            disabled={isScanning}
          >
            {isScanning ? (
              <ActivityIndicator color="#FFF" size="large" />
            ) : (
              <Ionicons name="scan" size={40} color="#FFF" />
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.manualContainer}>
          <View style={styles.manualContent}>
            <Ionicons name="person" size={50} color="#007AFF" />
            <Text style={styles.manualTitle}>Saisie Manuelle</Text>
            <TextInput
              style={styles.input}
              placeholder="Nom du destinataire"
              placeholderTextColor="#999"
              value={manualName}
              onChangeText={setManualName}
              autoCapitalize="words"
            />
            <TouchableOpacity
              style={[styles.submitBtn, !manualName.trim() && styles.submitBtnDisabled]}
              onPress={() => processName(manualName)}
              disabled={!manualName.trim() || isLoading}
            >
              {isLoading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.submitBtnText}>Valider</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}

      {/* Confirm Modal */}
      <Modal visible={showConfirmModal} transparent animationType="slide">
        <View style={styles.modalBg}>
          <View style={styles.modal}>
            <Ionicons name="checkmark-circle" size={50} color="#34C759" />
            <Text style={styles.modalTitle}>Nom Détecté</Text>
            <TextInput
              style={styles.modalInput}
              value={manualName}
              onChangeText={setManualName}
              autoCapitalize="words"
              autoFocus
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalBtnCancel} onPress={() => { setShowConfirmModal(false); setManualName(''); }}>
                <Text style={styles.modalBtnCancelText}>Réessayer</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalBtnConfirm} onPress={() => processName(manualName)} disabled={isLoading}>
                {isLoading ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={styles.modalBtnConfirmText}>Valider</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Result Modal */}
      <Modal visible={showResultModal} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={[styles.modal, styles.resultModal]}>
            <View style={[styles.resultIcon, lastResult?.is_new ? styles.iconNew : styles.iconUpdate]}>
              <Ionicons name={lastResult?.is_new ? 'person-add' : 'refresh'} size={40} color="#FFF" />
            </View>
            <Text style={styles.resultLabel}>{lastResult?.is_new ? 'Nouveau' : 'Mis à jour'}</Text>
            <Text style={styles.resultName}>{lastResult?.name}</Text>
            <Text style={styles.resultCount}>{lastResult?.package_count} colis</Text>
            <TouchableOpacity style={styles.resultBtn} onPress={resetScanner}>
              <Ionicons name="scan" size={20} color="#FFF" />
              <Text style={styles.resultBtnText}>Suivant</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* List Modal */}
      <Modal visible={showListModal} animationType="slide">
        <SafeAreaView style={styles.listContainer}>
          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>En Attente</Text>
            <TouchableOpacity onPress={() => setShowListModal(false)}>
              <Ionicons name="close" size={28} color="#333" />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.list}>
            {packages.map((p) => (
              <View key={p.id} style={styles.listItem}>
                <Text style={styles.listItemName}>{p.name}</Text>
                <View style={styles.listItemBadge}>
                  <Text style={styles.listItemBadgeText}>{p.numero}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.refreshBtn} onPress={fetchPackages}>
            <Ionicons name="refresh" size={18} color="#FFF" />
            <Text style={styles.refreshBtnText}>Actualiser</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </Modal>

      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#FFF" />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F5F5', padding: 20 },
  title: { fontSize: 20, fontWeight: 'bold', marginTop: 16, marginBottom: 20, color: '#333' },
  btn: { backgroundColor: '#007AFF', paddingHorizontal: 40, paddingVertical: 14, borderRadius: 25 },
  btnText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#007AFF', paddingHorizontal: 16, paddingVertical: 10 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#FFF' },
  headerBtns: { flexDirection: 'row', gap: 8 },
  headerBtn: { padding: 8, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8 },
  cameraContainer: { flex: 1 },
  camera: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  frame: { width: 280, height: 120, position: 'relative' },
  corner: { position: 'absolute', width: 30, height: 30, borderColor: '#00FF00' },
  tl: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4 },
  tr: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4 },
  br: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4 },
  hint: { marginTop: 16, color: '#FFF', fontSize: 14, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  captureBtn: { position: 'absolute', bottom: 40, alignSelf: 'center', width: 80, height: 80, borderRadius: 40, backgroundColor: '#007AFF', justifyContent: 'center', alignItems: 'center', borderWidth: 4, borderColor: '#FFF' },
  captureBtnDisabled: { backgroundColor: '#666' },
  manualContainer: { flex: 1, backgroundColor: '#F5F5F5' },
  manualContent: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  manualTitle: { fontSize: 22, fontWeight: 'bold', color: '#333', marginTop: 12, marginBottom: 20 },
  input: { width: '100%', backgroundColor: '#FFF', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 18, borderWidth: 2, borderColor: '#E5E5E5', marginBottom: 16 },
  submitBtn: { backgroundColor: '#34C759', paddingHorizontal: 40, paddingVertical: 14, borderRadius: 25 },
  submitBtnDisabled: { backgroundColor: '#CCC' },
  submitBtnText: { color: '#FFF', fontSize: 18, fontWeight: '600' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  modal: { backgroundColor: '#FFF', borderRadius: 20, padding: 24, width: '85%', alignItems: 'center' },
  modalTitle: { fontSize: 22, fontWeight: 'bold', color: '#333', marginTop: 8, marginBottom: 16 },
  modalInput: { width: '100%', backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 20, fontWeight: '600', textAlign: 'center', borderWidth: 2, borderColor: '#007AFF', marginBottom: 16 },
  modalBtns: { flexDirection: 'row', gap: 12, width: '100%' },
  modalBtnCancel: { flex: 1, backgroundColor: '#F0F0F0', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  modalBtnCancelText: { color: '#666', fontSize: 16, fontWeight: '600' },
  modalBtnConfirm: { flex: 1, backgroundColor: '#34C759', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  modalBtnConfirmText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  resultModal: { alignItems: 'center' },
  resultIcon: { width: 70, height: 70, borderRadius: 35, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  iconNew: { backgroundColor: '#34C759' },
  iconUpdate: { backgroundColor: '#007AFF' },
  resultLabel: { fontSize: 14, color: '#666' },
  resultName: { fontSize: 20, fontWeight: 'bold', color: '#333', marginVertical: 4 },
  resultCount: { fontSize: 28, fontWeight: 'bold', color: '#007AFF', marginBottom: 16 },
  resultBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#007AFF', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 25, gap: 8 },
  resultBtnText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  listContainer: { flex: 1, backgroundColor: '#F5F5F5' },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FFF', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#E5E5E5' },
  listTitle: { fontSize: 20, fontWeight: 'bold', color: '#333' },
  list: { flex: 1, padding: 12 },
  listItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FFF', padding: 14, borderRadius: 12, marginBottom: 8 },
  listItemName: { fontSize: 16, fontWeight: '600', color: '#333', flex: 1 },
  listItemBadge: { backgroundColor: '#007AFF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  listItemBadgeText: { color: '#FFF', fontWeight: 'bold', fontSize: 14 },
  refreshBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#007AFF', margin: 16, paddingVertical: 12, borderRadius: 12, gap: 8 },
  refreshBtnText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
});
