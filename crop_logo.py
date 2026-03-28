from PIL import Image

def crop_center_content():
    img_path = r"C:\Users\rokas\OneDrive\Desktop\Antigravity skills\PersonaPlexAI\backend\public\logo.png"
    img = Image.open(img_path).convert("RGBA")
    
    gray = img.convert("L")
    thresh = gray.point(lambda p: 255 if p > 15 else 0)
    bbox = thresh.getbbox()
    
    if bbox:
        cropped = img.crop(bbox)
        width, height = cropped.size
        new_size = max(width, height)
        
        square_img = Image.new("RGBA", (new_size, new_size), (0, 0, 0, 255))
        paste_x = (new_size - width) // 2
        paste_y = (new_size - height) // 2
        square_img.paste(cropped, (paste_x, paste_y))
        
        padding = int(new_size * 0.05)
        final_size = new_size + (padding * 2)
        final_img = Image.new("RGBA", (final_size, final_size), (0,0,0,255))
        final_img.paste(square_img, (padding, padding))
        
        final_img.save(img_path)
        print("Successfully cropped and centered.")
    else:
        print("Failed to find bounding box.")

if __name__ == "__main__":
    crop_center_content()
