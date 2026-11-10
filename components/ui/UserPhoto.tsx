import { Image, StyleSheet, View, type ImageStyle, type StyleProp } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "./Text";
import { mediaUrl } from "../../lib/api";
import { avatarFor, isAvatar } from "../../lib/avatars";
import { colors } from "../../lib/theme";

type Props = {
  // A photo URL, an avatar ("avatar:cheetah"), or nothing
  photo: string | null | undefined;
  style?: StyleProp<ImageStyle>;
  // Emoji size for boxes without a fixed width (e.g. a full card); otherwise worked out from the width
  emojiSize?: number;
  resizeMode?: "cover" | "contain";
};

// Someone's picture: their photo, their avatar, or a plain placeholder when they have neither
export function UserPhoto({ photo, style, emojiSize, resizeMode }: Props) {
  if (photo && !isAvatar(photo)) {
    return <Image source={{ uri: mediaUrl(photo) }} style={style} resizeMode={resizeMode} />;
  }
  const width = StyleSheet.flatten(style)?.width;
  const size = emojiSize ?? (typeof width === "number" ? Math.round(width * 0.55) : 28);
  const avatar = avatarFor(photo);
  return (
    <View
      style={[style as object, styles.tile, { backgroundColor: avatar ? avatar.color : colors.border }]}
      accessibilityLabel={avatar ? `${avatar.label} avatar` : "No photo"}
    >
      {avatar ? (
        <Text style={{ fontSize: size, lineHeight: Math.round(size * 1.25) }} allowFontScaling={false}>
          {avatar.emoji}
        </Text>
      ) : (
        <Ionicons name="person" size={size} color={colors.textFaint} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
});
